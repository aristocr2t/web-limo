/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { IncomingMessage, Server, ServerOptions, ServerResponse, createServer } from 'http';
import * as qs from 'querystring';

import { ControllerOptions, EndpointBuild, HttpMethod, MiddlewareType, ResponseHandler } from './Controller';
import { BodyOptions, HttpException, parseBody, parseCookie } from './utils';
import { validate } from './Validator';

export class Application {
	static async create(options: ApplicationOptions): Promise<Application> {
		for (let i = 0, { length } = options.controllers, controller: ControllerType; i < length; i++) {
			controller = options.controllers[i];

			if (typeof controller === 'string') {
				const imports = await import(controller);
				options.controllers[i] = Object
					.values(imports)
					.filter(c => typeof c === 'function' && (c as $ControllerType).__controller)
					.map((c) => {
						(c as $ControllerType).__module = controller as string;

						return c;
					}) as any;
			}
		}

		options.controllers = options.controllers.flat().map(c => {
			if (!(c as $ControllerType).__module) {
				(c as $ControllerType).__module = '';
			}

			return c;
		});

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

		if (!options.bodyOptions) {
			options.bodyOptions = {};
		}

		if (!options.hooks) {
			options.hooks = {};
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
			...(this.options.controllers as $ControllerType[])
				.filter(c => c.__endpoints)
				.map(c => Object.values(c.__endpoints).map(e => {
					e.module = c.__module;

					return e;
				}))
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

				const [location, querystring] = (req.url || '').split('?', 1) as [string, string?];

				let params!: string[];
				const endpoint = this.endpoints.find(ep => params = location.match(ep.location) as string[]);

				if (!endpoint || endpoint.method !== req.method) {
					throw new HttpException(404, 'Not found');
				}

				params = Array.from(params).slice(1);

				if (await this.resolveMiddlewares(req, res, endpoint.middleware as MiddlewareType[])) {
					return;
				}

				if (endpoint.responseHandler) {
					responseHandler = endpoint.responseHandler;
				}

				const controller = new endpoint.controller();

				if (endpoint.contextResolver) {
					Object.assign(controller, endpoint.contextResolver(req, res));
				}

				const auth = endpoint.authHandler ? await endpoint.authHandler(req, res) : null;

				const query = validate(qs.parse(querystring || ''), {
					type: 'object',
					schema: endpoint.query,
				}, 'query') as { [key: string]: any };

				let body: any = await parseBody(req, endpoint.bodyType || 'json', this.options.bodyOptions!);

				if (body !== undefined && endpoint.bodyType !== 'stream') {
					if (endpoint.body) {
						body = validate(body, {
							type: 'object',
							schema: endpoint.body,
						}, 'body') as any;
					} else if (endpoint.bodyRule) {
						body = validate(body, endpoint.bodyRule, 'body') as any;
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
	controllers: ControllerType[];
	responseHandler?: ResponseHandler;
	defaultActionCode?: number | string;
	bodyOptions?: BodyOptions;
	hooks?: {
		endpointsLoad?(endpoints: EndpointBuild[]): any | PromiseLike<any>;
	};
}

export type ControllerType = string | (new () => any);

export interface Logger {
	log(...args: any[]): void;
	debug(...args: any[]): void;
	info(...args: any[]): void;
	warn(...args: any[]): void;
	error(...args: any[]): void;
	dir(...args: any[]): void;
}

type $ControllerType = (new () => any) & {
	__controller: ControllerOptions;
	__endpoints: Record<string, EndpointBuild>;
	__module: string;
};
