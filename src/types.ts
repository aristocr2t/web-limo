import type { IncomingHttpHeaders, IncomingMessage, ServerOptions, ServerResponse } from 'http';

export interface ApplicationOptions extends ServerOptions {
	logger?: Logger;
	middlewares?: MiddlewareType[];
	controllers: (ControllerType | string)[];
	providers?: Provider[];
	responseHandler?: ResponseHandler;
	defaultActionCode?: number | string;
	bodyOptions?: BodyOptions;
	hooks?: {
		endpointsLoad?(endpoints: EndpointBuild[]): any | PromiseLike<any>;
	};
	parsers?: Partial<Parsers>;
}

export type ConstructorProvider = (new (...args: any[]) => { [key: string]: any });

export interface UseValueProvider {
	provide: (new (...args: any[]) => any) | string;
	useValue: any;
}

export interface UseClassProvider {
	provide: (new (...args: any[]) => any) | string;
	useClass: (new (...args: any[]) => any);
	deps?: any[];
	optionalDeps?: { index: number; defaultValue: any }[];
}

export interface UseFactoryProvider<D extends any[] = any[]> {
	provide: (new (...args: any[]) => any) | string;
	useFactory(...args: D): any;
	deps: D;
}

export type Provider =
| ConstructorProvider
| UseValueProvider
| UseClassProvider
| UseFactoryProvider;

export interface Logger {
	log(...args: any[]): void;
	debug(...args: any[]): void;
	info(...args: any[]): void;
	warn(...args: any[]): void;
	error(...args: any[]): void;
	dir(...args: any[]): void;
}

// utils

export interface File {
	size: number;
	path: string;
	name: string;
	type: string;
	lastModifiedDate?: Date;
	hash?: string;
}

export interface Cookies {
	[key: string]: string | string[];
}

export type BodyType = 'urlencoded' | 'json' | 'multipart' | 'text' | 'raw' | 'stream';

export interface BodyOptions extends Partial<Record<BodyType, { limit?: number }>> {
	multipart?: {
		limit?: number;
	} & MultipartOptions;
}

export interface MultipartOptions {
	encoding?: string;
	uploadDir?: string;
	keepExtensions?: boolean;
	maxFileSize?: number;
	maxFieldsSize?: number;
	maxFields?: number;
	hash?: string | boolean;
	multiples?: boolean;
	filename?(filename: string): string;
}

export type JsonData = string | number | boolean | null | { [key: string]: JsonData } | JsonData[];
export interface UrlencodedData {
	[key: string]: string | string[];
}
export interface MultipartData {
	[key: string]: string | string[] | File;
}

export interface Parsers {
	json: {
		parse(text: string): any;
		stringify(value: any): string;
	};
	qs: {
		parse(text: string): any;
		stringify(value: any): string;
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
	controller: ControllerType;
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

export type EndpointHandler = (request: RequestData) => any | PromiseLike<any>;
export type AuthHandler = (req: IncomingMessage, res: ServerResponse) => any | PromiseLike<any>;
export type ResponseHandler = (res: ServerResponse, err: Error | null, body: any) => void | PromiseLike<void>;
export type MiddlewareType = (req: IncomingMessage, res: ServerResponse) => boolean | PromiseLike<boolean>;

export interface ValidationSchema {
	[key: string]: ValidationRule;
}

export type PrimitiveRule<T = any> =
| BooleanRule<T>
| StringRule<T>
| NumberRule<T>
| DateRule<T>
| ArrayRule<T>
| ObjectRule<T>;

export type ValidationRule<T = any> =
| PrimitiveRule<T>
| PrimitiveRule<T>[];

export interface DefaultRule<T> {
	default?: ((x: any, r: ValidationRule) => any) | any;
	parse?(x: any, rule: PrimitiveRule): T;
	optional?: boolean;
}

export interface BooleanRule<T = boolean> extends DefaultRule<T> {
	type: 'boolean';
	truthy?: any[];
	falsy?: any[];
}

export interface StringRule<T = string> extends DefaultRule<T> {
	type: 'string';
	min?: number;
	max?: number;
	length?: number;
	values?: string[];
	pattern?: string | RegExp;
	trim?: boolean;
	escape?: StringEscapeLevels;
}

export type StringEscapeLevels = 1 | 2;

export interface NumberRule<T = number> extends DefaultRule<T> {
	type: 'number';
	integer?: boolean;
	digits?: number;
	roundingFn?: 'floor' | 'round' | 'ceil';
	min?: number;
	max?: number;
	values?: number[];
}

export interface DateRule<T = Date> extends DefaultRule<T> {
	type: 'date';
	min?: number | string | Date | (() => number | string | Date);
	max?: number | string | Date | (() => number | string | Date);
}

export interface ArrayRule<T = any[]> extends DefaultRule<T> {
	type: 'array';
	nested?: ValidationRule;
	length?: number;
	min?: number;
	max?: number;
}

export interface ObjectRule<T = object> extends DefaultRule<T> {
	type: 'object';
	nested?: ValidationRule;
	schema?: ValidationSchema;
}
