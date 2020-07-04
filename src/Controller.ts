import type { IncomingMessage, ServerResponse } from 'http';

import type { EndpointBuild, MiddlewareType, RequestData } from './Application';
import { BodyType, SetMetadata, parseName } from './utils';
import type {
	ArrayValidationRule,
	BigintValidationRule,
	BooleanValidationRule,
	DateValidationRule,
	NumberValidationRule,
	ObjectValidationRule,
	StringValidationRule,
	ValidationRule,
	ValidationSchema,
} from './Validator';

export function Controller(options?: ControllerOptions): <Target extends (new (...args: any[]) => any)>(target: Target) => Target | void {
	return <Target extends (new (...args: any[]) => any)>(target: Target): Target | void => {
		const ControllerClass = target as unknown as $ControllerType;
		options = options ?? {};

		options.method = [options.method || 'GET'].flat().filter(Boolean) as HttpMethod[];
		options.useMethodNames = options.useMethodNames ?? false;
		options.path = options.path ?? parseName(target.name, 'Controller');
		options.authHandler = options.authHandler ?? undefined;
		options.middleware = [options.middleware].flat().filter(Boolean) as MiddlewareType[];
		options.responseHandler = options.responseHandler ?? undefined;
		options.contextResolver = options.contextResolver ?? undefined;

		const endpoints = (ControllerClass.__endpoints || {}) as Record<string, EndpointBuild>;
		const keys = Object.keys(endpoints) as (keyof typeof endpoints & string)[];

		for (const key of keys) {
			const endpoint = endpoints[key];
			endpoint.controller = ControllerClass;
			endpoint.method = [endpoint.method || options.method].flat().filter(Boolean);
			endpoint.contextResolver = options.contextResolver;

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

		return (SetMetadata('__controller', options) as ClassDecorator)(target);
	};
}

type ArrayElement<V, R = never> = V extends any[] ? V[number] : R;

type SchemaProp<V> = V extends StringValidationRule ? ArrayElement<V['values'], string> :
	V extends NumberValidationRule ? ArrayElement<V['values'], number> :
		V extends BooleanValidationRule ? boolean :
			V extends BigintValidationRule ? bigint | string :
				V extends DateValidationRule ? Date | string :
					V extends ArrayValidationRule ? ArrayElement<V['nested'], SchemaProp<V>>[] :
						V extends ObjectValidationRule ? (
							V['schema'] extends object ? Schema<V['schema']> :
								(
									V['nested'] extends ValidationRule ? { [key: string]: ArrayElement<V['nested'], SchemaProp<V>> } : { [key: string]: any }
								)
						) : never;

type Schema<B> = {
	[P in keyof B]: SchemaProp<B[P]>;
};

export function Endpoint<
	Options extends EndpointOptions,
	Query = Options['query'],
	Body = Options['body'],
	BodyRule = Options['bodyRule'],
	BodyType = Options['bodyType'],
>(options: Options): <
	Method extends (
		requestData: RequestData<
		any,
		Query extends ValidationSchema ? Schema<Query> : any,
		BodyType extends 'stream' ? IncomingMessage :
			BodyType extends 'text' ? string :
				BodyType extends 'raw' ? Buffer :
					Body extends ValidationSchema ? Schema<Body> :
						BodyRule extends ValidationRule ? SchemaProp<BodyRule> : any
		>,
		context: any,
	) => any | PromiseLike<any>,
>(
	target: {},
	propertyKey: string,
	descriptor: TypedPropertyDescriptor<Method>,
) => TypedPropertyDescriptor<Method> | void {
	return (target, propertyKey, descriptor) => {
		(options as unknown as EndpointBuild).handler = target[propertyKey as keyof typeof target];

		if (options.body) {
			const keys = Object.keys(options.body);

			for (const key of keys) {
				const value = options.body[key];

				if (Array.isArray(value)) {
					options.body[key] = value.flat();
				}
			}
		}

		if (Array.isArray(options.bodyRule)) {
			options.bodyRule = options.bodyRule.flat();
		}

		return (SetMetadata('__endpoints', options) as MethodDecorator)(target, propertyKey, descriptor);
	};
}

export interface ControllerOptions {
	path?: string | (string | RegExp)[];
	method?: HttpMethod | HttpMethod[];
	useMethodNames?: boolean;
	contextResolver?: ContextResolver;
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
	method?: HttpMethod | HttpMethod[];
	query?: Query;
	body?: Body;
	bodyRule?: BodyRule;
	bodyType?: BodyType;
	authHandler?: AuthHandler | null;
	middleware?: MiddlewareType | MiddlewareType[];
	responseHandler?: ResponseHandler;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
export type AuthHandler = (req: IncomingMessage, res: ServerResponse) => any | PromiseLike<any>;
export type ContextResolver = (req: IncomingMessage, res: ServerResponse) => { [key: string]: any } | PromiseLike<{ [key: string]: any }>;
export type ResponseHandler = (res: ServerResponse, err: Error | null, body: any) => void | PromiseLike<void>;

type $ControllerType = (new () => any) & {
	__controller: ControllerOptions;
	__endpoints: Record<string, EndpointBuild>;
	__module: string;
};
