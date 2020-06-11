import { IncomingMessage, ServerResponse } from 'http';

import { EndpointHandler, MiddlewareType } from './Application';
import { SetMetadata, parseName } from './utils';
import { ValidationRule, ValidationSchema } from './Validator';

export function Controller(options?: ControllerOptions): ClassDecorator {
	// eslint-disable-next-line @typescript-eslint/ban-types
	return <TFunction extends Function>(target: TFunction): TFunction | void => {
		const ControllerClass = target as unknown as $ControllerType;
		options = options ?? {};

		options.method = [options.method || 'GET'].flat().filter(Boolean) as HttpMethod[];
		options.useMethodNames = options.useMethodNames ?? true;
		options.path = options.path ?? parseName(target.name, 'Controller');
		options.authHandler = options.authHandler ?? undefined;
		options.middleware = [options.middleware].flat().filter(Boolean) as MiddlewareType[];
		options.responseHandler = options.responseHandler ?? undefined;
		options.contextResolver = options.contextResolver ?? undefined;

		const endpoints = (ControllerClass.__endpoints || {}) as Record<string, $Endpoint>;
		const keys = Object.keys(endpoints) as (keyof typeof endpoints & string)[];

		for (const key of keys) {
			const endpoint = endpoints[key];
			endpoint.controller = ControllerClass;
			endpoint.method = [endpoint.method || options.method].flat().filter(Boolean);
			endpoint.contextResolver = options.contextResolver;

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
					.map((p: RegExp | string) => (p instanceof RegExp ? `(${p.source.replace(/(^\^)|(\$)\||\|(\^)|(\$$))/g, '')})` : p))
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

export function Endpoint(options: EndpointOptions): MethodDecorator {
	return <T>(
		target: Record<string, any>,
		propertyKey: string | symbol,
		descriptor: TypedPropertyDescriptor<T>,
	): TypedPropertyDescriptor<T> | void => {
		(options as $Endpoint).handler = target[propertyKey as keyof typeof target];

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

export interface EndpointOptions {
	path?: string;
	method?: HttpMethod | HttpMethod[];
	query?: ValidationSchema;
	body?: ValidationSchema;
	bodyRule?: ValidationRule;
	authHandler?: AuthHandler | null;
	middleware?: MiddlewareType | MiddlewareType[];
	responseHandler?: ResponseHandler;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
export type AuthHandler = (req: IncomingMessage, res: ServerResponse) => any | PromiseLike<any>;
export type ContextResolver = (req: IncomingMessage, res: ServerResponse) => { [key: string]: any } | PromiseLike<{ [key: string]: any }>;
export type ResponseHandler = (res: ServerResponse, err: Error | null, body: any) => void | PromiseLike<void>;

type $ControllerType = (new () => any) & Partial<{
	__controller: ControllerOptions;
	__endpoints: $Endpoint[];
}>;
type $Endpoint = EndpointOptions & Partial<{
	method: HttpMethod[];
	controller: $ControllerType;
	handler: EndpointHandler;
	location: RegExp;
	locationTemplate: string;
	contextResolver?(req: IncomingMessage, res: ServerResponse): Record<string, any>;
}>;
