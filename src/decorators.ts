/* eslint-disable @typescript-eslint/no-unsafe-return */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';

import { BodyType, Cookies, parseName } from './utils';
import type {
	ArrayRule,
	BooleanRule,
	DateRule,
	NumberRule,
	ObjectRule,
	PrimitiveRule,
	StringRule,
	ValidationRule,
	ValidationSchema,
} from './validator';

export function Injectable(options?: InjectableOptions): ClassDecorator {
	return (target) => {
		if (!options) {
			options = {};
		}

		if (!options.deps) {
			options.deps = (Reflect.getMetadata('design:paramtypes', target) as any[] || [])
				.map((pt, i) => Reflect.getMetadata('weblimo:inject', target, i.toString()) || pt);
		}

		if (!(options as unknown as { optionalDeps: { index: number; defaultValue: any }[] }).optionalDeps) {
			(options as unknown as { optionalDeps: { index: number; defaultValue: any }[] }).optionalDeps = (options.deps.map((_, i) => {
				if (Reflect.hasMetadata('weblimo:optional', target, i.toString())) {
					return { index: i, defaultValue: Reflect.getMetadata('weblimo:optional', target, i.toString()) };
				}
			})).filter(Boolean) as { index: number; defaultValue: any }[];
		}

		Reflect.metadata('weblimo:injectable', options)(target);
	};
}

export function Inject(token: string): ParameterDecorator {
	return (target, _, index) => {
		Reflect.metadata('weblimo:inject', token)(target, index.toString());
	};
}

export function Optional(defaultValue?: any): ParameterDecorator {
	return (target, _, index) => {
		Reflect.metadata('weblimo:optional', defaultValue)(target, index.toString());
	};
}

export const Req: ParameterDecorator = Inject('REQUEST');
export const Res: ParameterDecorator = Inject('RESPONSE');

export function Controller(options?: ControllerOptions): ClassDecorator {
	return (target) => {
		options = options ?? {};

		if (!options.method) options.method = 'GET';
		options.useMethodNames = options.useMethodNames ?? false;
		options.path = options.path ?? parseName(target.name, 'Controller');
		options.authHandler = options.authHandler ?? undefined;
		options.middleware = [options.middleware].flat().filter(Boolean) as MiddlewareType[];
		options.responseHandler = options.responseHandler ?? undefined;

		let endpoints: { [key: string]: EndpointBuild };

		if (Reflect.hasMetadata('weblimo:endpoints', target)) {
			endpoints = Reflect.getMetadata('weblimo:endpoints', target);
		} else {
			endpoints = {};
			Reflect.metadata('weblimo:endpoints', endpoints)(target);
		}

		const keys = Object.keys(endpoints) as (keyof typeof endpoints & string)[];

		for (const key of keys) {
			const endpoint = endpoints[key];
			endpoint.controller = target as unknown as ControllerType;

			if (!endpoint.method) {
				endpoint.method = options.method || 'GET';
			}

			if (!endpoint.bodyType && (endpoint.method.includes('POST') || endpoint.method.includes('PUT') || endpoint.method.includes('PATCH') || endpoint.method.includes('DELETE'))) {
				endpoint.bodyType = 'json';
			}

			if (endpoint.authHandler === undefined) {
				endpoint.authHandler = options.authHandler ?? null;
			}

			endpoint.middleware = endpoint.middleware ? [options.middleware, endpoint.middleware].flat().filter(Boolean)! : options.middleware;

			if (typeof endpoint.responseHandler !== 'function' && typeof options.responseHandler === 'function') {
				endpoint.responseHandler = options.responseHandler;
			}

			const controllerName = options.path;
			const actionName = options.useMethodNames
				? parseName(key)
				: [endpoint.path!]
					.flat()
					.filter(Boolean)
					.map((p: RegExp | string) => (p instanceof RegExp ? `(${p.source.replace(/(?:^(\^))|(?:(\$)\|)|(?:\|(\^))|(?:(\$)$)/g, '')})` : p))
					.join('/');

			const location
				= `/${[controllerName, actionName]
					.filter(Boolean)
					.join('/')
					.toLowerCase()}`;

			endpoint.location = new RegExp(`^${location}$`);
			endpoint.locationTemplate = location;
		}

		Injectable(options)(target);

		return Reflect.metadata('weblimo:controller', options)(target);
	};
}

type ArrayElement<V, R = never> = V extends any[] ? V[number] : R;

type SchemaProp<Rule extends PrimitiveRule> =
NonNullable<Rule['parse']> extends (...args: any) => infer R ? R :
	(
		Rule extends StringRule ? ArrayElement<Rule['values'], string> :
			Rule extends NumberRule ? ArrayElement<Rule['values'], number> :
				Rule extends BooleanRule ? boolean :
					Rule extends DateRule ? Date :
						Rule extends ArrayRule ? ArrayElement<Rule['nested'], SchemaProp<Rule>>[] :
							Rule extends ObjectRule ? (
								Rule['schema'] extends ValidationSchema ? Schema<Rule['schema']> :
									(
										Rule['nested'] extends ValidationRule ? { [key: string]: ArrayElement<Rule['nested'], SchemaProp<Rule>> } : { [key: string]: any }
									)
							) : never
	);

type Schema<B extends ValidationSchema | undefined> = {
	[P in keyof B]: B[P] extends PrimitiveRule[] ? SchemaProp<B[P][number]> : B[P] extends PrimitiveRule ? SchemaProp<B[P]> : never;
};

type PromiseType<T> = T extends PromiseLike<any> ? Parameters<NonNullable<Parameters<T['then']>[0]>>[0] : T;

export function Endpoint<
	Options extends EndpointOptions,
	Query = Options['query'],
	Body = Options['body'],
	BodyRule = Options['bodyRule'],
	BodyType = Options['bodyType'],
	BodyParserValue = Options['bodyParser'] extends (...args: any[]) => any ? ReturnType<Options['bodyParser']> : undefined,
	AuthHandlerValue = Options['authHandler'] extends (...args: any[]) => any ? PromiseType<ReturnType<Options['authHandler']>> : null,
>(options: Options): <
	Method extends (
		requestData: RequestData<
		AuthHandlerValue,
		Query extends ValidationSchema ? Schema<Query> : any,
		BodyType extends 'stream' ? IncomingMessage :
			BodyType extends 'text' ? string :
				BodyType extends 'raw' ? Buffer :
					Body extends ValidationSchema ? BodyParserValue extends undefined ? Schema<Body> : BodyParserValue :
						BodyRule extends PrimitiveRule[] ? SchemaProp<BodyRule[number]> :
							BodyRule extends PrimitiveRule ? SchemaProp<BodyRule> :
								BodyParserValue extends undefined ? any : BodyParserValue
		>,
		context: any,
	) => any | PromiseLike<any>,
>(
	target: { [key: string]: any },
	propertyKey: string,
	descriptor: TypedPropertyDescriptor<Method>,
) => TypedPropertyDescriptor<Method> | void {
	return (target, propertyKey, descriptor) => {
		const targetc = target.constructor;
		(options as unknown as EndpointBuild).handler = target[propertyKey as keyof typeof target];
		(options as unknown as EndpointBuild).descriptor = descriptor;

		if (options.body) {
			const keys = Object.keys(options.body);

			for (const key of keys) {
				const value = options.body[key];

				if (Array.isArray(value)) {
					options.body[key] = value.flat();
				}
			}
		}

		let endpoints: { [key: string]: EndpointOptions };

		if (Reflect.hasMetadata('weblimo:endpoints', targetc)) {
			endpoints = Reflect.getMetadata('weblimo:endpoints', targetc);
		} else {
			endpoints = {};
			Reflect.metadata('weblimo:endpoints', endpoints)(targetc);
		}

		endpoints[propertyKey] = options as EndpointOptions;

		return descriptor;
	};
}

export interface InjectableOptions {
	deps?: ((new (...args: any[]) => any) | string)[];
}

export type ControllerType = new (...args: any[]) => { [key: string]: any };

export interface ControllerOptions extends InjectableOptions {
	path?: string | (string | RegExp)[];
	method?: HttpMethod;
	useMethodNames?: boolean;
	authHandler?: AuthHandler;
	middleware?: MiddlewareType | MiddlewareType[];
	responseHandler?: ResponseHandler;
}

export interface EndpointOptions<
	Query extends ValidationSchema = ValidationSchema,
	Body extends ValidationSchema = ValidationSchema,
	BodyRule extends ValidationRule = ValidationRule,
> {
	path?: string | (string | RegExp)[];
	method?: HttpMethod;
	query?: Query;
	body?: Body;
	bodyRule?: BodyRule;
	bodyType?: BodyType;
	bodyParser?(x: unknown, rule: ObjectRule): any;
	authHandler?: AuthHandler | null;
	middleware?: MiddlewareType | MiddlewareType[];
	responseHandler?: ResponseHandler;
}

export type EndpointBuild = EndpointOptions & {
	method: HttpMethod;
	controller: new () => { [key: string]: any };
	handler: EndpointHandler;
	location: RegExp;
	locationTemplate: string;
	descriptor: PropertyDescriptor;
};

export interface RequestData<Auth = any, Query extends {} = {}, Body = any> {
	method: HttpMethod;
	auth: Auth;
	query: Query;
	body: Body;
	params: string[];
	cookies: Cookies;
	headers: IncomingHttpHeaders;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
export type ContextResolver = (req: IncomingMessage, res: ServerResponse) => { [key: string]: any } | PromiseLike<{ [key: string]: any }>;

export type EndpointHandler = (request: RequestData, context: { [key: string]: any }) => any | PromiseLike<any>;
export type AuthHandler = (req: IncomingMessage, res: ServerResponse) => any | PromiseLike<any>;
export type ResponseHandler = (res: ServerResponse, err: Error | null, body: any) => void | PromiseLike<void>;
export type MiddlewareType = (req: IncomingMessage, res: ServerResponse) => boolean | PromiseLike<boolean>;
