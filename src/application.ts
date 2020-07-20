/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { IncomingMessage, Server, ServerOptions, ServerResponse, createServer } from 'http';
import * as qs from 'querystring';
import { inspect } from 'util';

import { ControllerType, EndpointBuild, HttpMethod, InjectableOptions, MiddlewareType, ResponseHandler } from './decorators';
import { BodyOptions, HttpException, Parsers, parseBody, parseCookie } from './utils';
import { validate } from './validator';

export class Application {
	static async create(options: ApplicationOptions): Promise<Application> {
		for (let i = 0, len = options.controllers.length, controllerOrPath: ControllerType | string; i < len; i++) {
			controllerOrPath = options.controllers[i];

			if (typeof controllerOrPath === 'string') {
				const imports = await import(controllerOrPath);
				const controllers = Object
					.values(imports)
					.filter(c => typeof c === 'function' && Reflect.hasMetadata('weblimo:endpoints', c)) as ControllerType[];

				options.controllers[i] = controllers as any;
			}
		}

		options.controllers = options.controllers.flat();

		const application = new Application(options);

		return application;
	}

	address: string | undefined;
	private readonly server: Server;
	private readonly options: ApplicationOptions;
	private readonly endpoints: EndpointBuild[] = [];

	private constructor(options: ApplicationOptions) {
		if (!options.middlewares) {
			options.middlewares = [];
		}

		if (!options.providers) {
			options.providers = [];
		}

		for (let i = 0, len = options.providers.length; i < len; i++) {
			const provider = options.providers[i];

			if (typeof provider === 'function') {
				const injectableOptions = Reflect.getMetadata('weblimo:injectable', provider) as InjectableOptions;

				if (!injectableOptions) {
					throw new Error(`Need to provide "Injectable" decorator to class "${provider.name}"`);
				}

				options.providers[i] = {
					provide: provider,
					useClass: provider,
					deps: injectableOptions.deps!,
					optionalDeps: (injectableOptions as { [key: string]: any }).optionalDeps,
				};
			}
		}

		if (!options.bodyOptions) {
			options.bodyOptions = {};
		}

		if (!options.hooks) {
			options.hooks = {};
		}

		if (!options.parsers) {
			options.parsers = {};
		}

		if (!options.parsers.json) {
			options.parsers.json = JSON;
		}

		if (!options.parsers.qs) {
			options.parsers.qs = qs;
		}

		if (options.defaultActionCode === undefined) {
			options.defaultActionCode = 0;
		}

		if (options.responseHandler) {
			this.responseHandler = options.responseHandler;
		}

		this.options = options;

		// LOAD ENDPOINTS
		this.loadEndpoints();

		this.server = createServer(this.requestHandler);
	}

	listen(port: number): Promise<this>;
	listen(port: number, host: string): Promise<this>;
	listen(port: number, host?: string): Promise<this> {
		return new Promise((resolve, reject) => {
			this.server.listen(port, host, () => {
				this.address = `http://${host || 'localhost'}:${port}/`;
				resolve(this);
			}).on('error', (err) => {
				reject(err);
			});
		});
	}

	private loadEndpoints(): void {
		this.endpoints.push(
			...this.options.controllers
				.filter(c => typeof c === 'function' && Reflect.hasMetadata('weblimo:endpoints', c))
				.map(c => Object.values(Reflect.getMetadata('weblimo:endpoints', c) as { [key: string]: EndpointBuild }))
				.flat()
		);

		const locationTemplates = this.endpoints
			.map(ep => `${ep.method} ${ep.locationTemplate}`);

		for (let i = 0, len = locationTemplates.length, lt: string; i < len; i++) {
			lt = locationTemplates[i];

			if (locationTemplates.indexOf(lt) !== i) {
				throw new Error(`Some endpoints have the same location: ${lt}`);
			}
		}

		if (this.options.logger) {
			for (const lt of locationTemplates) {
				this.options.logger.info(`add location ${lt}`);
			}
		}

		if (this.options.hooks!.endpointsLoad) {
			this.options.hooks!.endpointsLoad(this.endpoints);
		}
	}

	private async resolveMiddlewares(req: IncomingMessage, res: ServerResponse, middlewares: MiddlewareType[]): Promise<boolean> {
		for (const m of middlewares) {
			let response = m(req, res);

			if (response instanceof Promise) {
				response = await response;
			}

			if (response) {
				return true;
			}
		}

		return false;
	}

	private resolveArgs(target: Provider, providers: (UseValueProvider | UseClassProvider | UseFactoryProvider)[], deps: ((new (...args: any[]) => any) | string)[], optionalDeps: { index: number; defaultValue: any }[] = []): any[] {
		return deps.map((pt, i) => {
			const provider = providers.find(p => (typeof p === 'object' ? p.provide === pt : p === pt));

			if (!provider) {
				const optionalDep = optionalDeps.find(x => x.index === i);

				if (optionalDep) {
					return optionalDep.defaultValue;
				}

				throw new Error(`Provider of param #${i} not found for "${typeof target === 'function' ? target.name : inspect(target, false, null, false)}"`);
			}

			if ('useClass' in provider) {
				const args = this.resolveArgs(provider, providers, provider.deps!, provider.optionalDeps!);

				return new provider.useClass(...args);
			}

			if ('useFactory' in provider) {
				const args = this.resolveArgs(provider, providers, provider.deps);

				return provider.useFactory(...args);
			}

			return provider.useValue;
		});
	}

	private resolveConstructorProvider(constructor: ConstructorProvider, providers: (UseValueProvider | UseClassProvider | UseFactoryProvider)[]): { [key: string]: any } {
		const options = Reflect.getMetadata('weblimo:injectable', constructor) as InjectableOptions;

		if (!options) {
			throw new Error(`Need to provide "Injectable" decorator to class "${constructor.name}"`);
		}

		const args = this.resolveArgs(constructor, providers, options.deps!, (options as { [key: string]: any }).optionalDeps);

		return new constructor(...args);
	}

	private readonly responseHandler: ResponseHandler = (res: ServerResponse, err: Error | null, body: any) => {
		if (err) {
			return res.end(err.message);
		}

		res.end(body);
	};

	private readonly requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
		Promise.resolve(this.responseHandler)
			.then(async (responseHandler) => {
				if (await this.resolveMiddlewares(req, res, this.options.middlewares!)) {
					return;
				}

				const [location, querystring] = (req.url || '').split('?', 2) as [string, string?];

				let params!: string[];
				const endpoint = this.endpoints.find(ep => {
					params = location.match(ep.location) as string[];

					if (params && (req.method === ep.method || (req.method === 'HEAD' && ep.method === 'GET'))) {
						return true;
					}

					return false;
				});

				if (!endpoint) {
					throw new HttpException(404, undefined, new Error('Not found'));
				}

				const parsers = this.options.parsers as Parsers;

				params = Array.from(params).slice(1);

				if (await this.resolveMiddlewares(req, res, endpoint.middleware as MiddlewareType[])) {
					return;
				}

				if (endpoint.responseHandler) {
					responseHandler = endpoint.responseHandler;
				}

				const providers: (UseValueProvider | UseClassProvider | UseFactoryProvider)[] = [
					{ provide: 'REQUEST', useValue: req },
					{ provide: 'RESPONSE', useValue: res },
					...this.options.providers! as (UseValueProvider | UseClassProvider | UseFactoryProvider)[],
				];

				const controller = this.resolveConstructorProvider(endpoint.controller, providers);

				const auth = endpoint.authHandler ? await endpoint.authHandler(req, res) : null;

				let query: { [key: string]: any };

				try {
					query = validate(parsers.qs!.parse(querystring || ''), {
						type: 'object',
						schema: endpoint.query,
					}, 'query', true) as { [key: string]: any };
				} catch (err) {
					throw new HttpException(400, undefined, err);
				}

				let body: any = await parseBody(req, endpoint.bodyType || 'json', parsers, this.options.bodyOptions!);

				if (body !== undefined && endpoint.bodyType !== 'stream') {
					try {
						const isQuery = endpoint.bodyType === 'multipart' || endpoint.bodyType === 'urlencoded';

						if (endpoint.body) {
							body = validate(body, {
								type: 'object',
								schema: endpoint.body,
								parse: endpoint.bodyParser,
							}, 'body', isQuery) as any;
						} else if (endpoint.bodyRule) {
							body = validate(body, endpoint.bodyRule, 'body', isQuery) as any;
						}
					} catch (err) {
						throw new HttpException(400, undefined, err);
					}
				}

				const headers = req.headers;
				const method = req.method as HttpMethod;
				const cookies = parseCookie(req);

				let responseBody = endpoint.handler.call(controller, {
					method,
					auth,
					body,
					query,
					params,
					headers,
					cookies,
				}, controller);

				if (responseBody instanceof Promise) {
					responseBody = await responseBody;
				}

				await responseHandler(res, null, responseBody);
			})
			.catch(err => this.responseHandler(res, err, undefined));
	};
}

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
