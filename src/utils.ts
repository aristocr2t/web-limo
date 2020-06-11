/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import contentType from 'content-type';
import { File, IncomingForm } from 'formidable';
import { IncomingMessage } from 'http';
import qs from 'querystring';
import rawBody from 'raw-body';

export function snakeCase(value: string): string {
	return value ? value.replace(/(?:[^\w\d]+)?([A-Z]+)/g, (fm, m: string) => `_${m.toLowerCase()}`).replace(/^_/, '') : '';
}

export function parseName(name: string, postfix?: string): string {
	return snakeCase(typeof postfix === 'string' ? name.replace(new RegExp(`${postfix}$`), '') : name);
}

export function SetMetadata(key: string, data: any): ClassDecorator | MethodDecorator | PropertyDecorator {
	return <T>(target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<T>) => {
		if (propertyKey) {
			target = target.constructor;

			if (!target[key]) {
				target[key] = {};
			}

			target[key][propertyKey] = data;

			if (descriptor) {
				return descriptor;
			}
		} else {
			target[key] = data;

			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return target;
		}
	};
}

export function isEqual(a: any, b: any, checkPrototype: boolean = false): boolean {
	if (a === b) {
		return true;
	}

	if (a instanceof Date && b instanceof Date) {
		return +a === +b;
	}

	if (typeof a === 'object' && typeof b === 'object' && a && b) {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		const { length } = aKeys;

		if (checkPrototype) {
			return b instanceof Object.getPrototypeOf(a).constructor && a instanceof Object.getPrototypeOf(b).constructor;
		}

		if (length === bKeys.length && aKeys.filter(k => bKeys.includes(k)).length === length) {
			for (let i = 0, key: string = aKeys[i]; i < length; i++, key = aKeys[i]) {
				if (!isEqual(a[key], b[key], checkPrototype)) {
					return false;
				}
			}

			return true;
		}
	}

	if (typeof a === 'number' && isNaN(a) && isNaN(b) && typeof b === 'number') {
		return true;
	}

	return false;
}

export function parseMultipart(req: IncomingMessage): Promise<MultipartData> {
	return new Promise<MultipartData>((resolve, reject) => {
		const form = new IncomingForm();
		form.parse(req, (err: Error | null, fields: Record<string, string | string[]>, files: Record<string, File>) => {
			if (err) {
				return reject(err);
			}

			return resolve({
				...fields,
				...files,
			});
		});
	});
}

export async function parseBody(
	req: IncomingMessage,
	options: BodyOptions,
): Promise<string | Buffer | JsonData | UrlencodedData | MultipartData | IncomingMessage> {
	try {
		const { type, parameters } = contentType.parse(req);

		const parseOptions = {
			length: req.headers['content-length'],
			encoding: parameters.charset,
		};

		switch (type) {
			case 'multipart/form-data':
				const data = await parseMultipart(req);

				return data;
			case 'application/x-www-form-urlencoded': {
				const raw = await rawBody(req, {
					...parseOptions,
					limit: options.urlencoded?.limit,
				});

				return qs.parse(raw) as UrlencodedData;
			}

			case 'application/json': {
				const raw = await rawBody(req, {
					...parseOptions,
					limit: options.json?.limit,
				});

				return JSON.parse(raw) as JsonData;
			}

			default: {
				if (type.startsWith('text/')) {
					const raw = await rawBody(req, {
						...parseOptions,
						limit: options.text?.limit,
					});

					return raw;
				}

				const raw = await rawBody(req, {
					...parseOptions,
					limit: options.raw?.limit,
				});

				return raw;
			}
		}
	} catch (err) {
		throw err;
	}
}

export function parseCookie(req: IncomingMessage): Cookies {
	const { cookie } = req.headers;
	const cookies: Record<string, string> = {};

	if (cookie && cookie !== '') {
		const cookieItems = cookie.split(';');

		for (const item of cookieItems) {
			const [name, value] = item.trim().split('=');
			cookies[decodeURIComponent(name)] = decodeURIComponent(value);
		}
	}

	return cookies;
}

export type Cookies = Record<string, string>;
export type BodyTypes = 'urlencoded' | 'json' | 'multipart' | 'text' | 'raw' | 'stream';
export type BodyOptions = Partial<Record<BodyTypes, { limit: string }>>;

export type JsonData = string | number | boolean | null | { [key: string]: JsonData } | JsonData[];
export type UrlencodedData = Record<string, string | string[]>;
export type MultipartData = Record<string, string | string[] | File>;
