/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as contentType from 'content-type';
import { IncomingForm } from 'formidable';
import type { IncomingMessage } from 'http';
import * as rawBody from 'raw-body';
import type { Readable } from 'stream';

export class HttpException extends Error {
	constructor(readonly statusCode: number = 500, message?: string, readonly details?: any) {
		super(message);
		Object.setPrototypeOf(this, HttpException.prototype);
	}
}

export function snakeCase(value: string): string {
	return value ? value.replace(/(?:[^\w\d]+)?([A-Z]+)/g, (fm, m: string) => `_${m.toLowerCase()}`).replace(/^_/, '') : '';
}

export function parseName(name: string, postfix?: string): string {
	return snakeCase(typeof postfix === 'string' ? name.replace(new RegExp(`${postfix}$`), '') : name);
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

export interface File {
	size: number;
	path: string;
	name: string;
	type: string;
	lastModifiedDate?: Date;
	hash?: string;
}

export function parseMultipart(req: IncomingMessage, options: MultipartOptions = {}): Promise<MultipartData> {
	return new Promise<MultipartData>((resolve, reject) => {
		if (!options.uploadDir) {
			options.uploadDir = 'tmp';
		}

		if (typeof options.keepExtensions !== 'boolean') {
			options.keepExtensions = true;
		}

		const form = new IncomingForm(options as any);
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

const BodyTypes: { [key: string]: BodyType } = {
	'application/json': 'json',
	'application/x-www-form-urlencoded': 'urlencoded',
	'multipart/form-data': 'multipart',
};

export async function parseBody(
	req: IncomingMessage,
	bodyType: 'json',
	parsers: Parsers,
	options: BodyOptions,
): Promise<JsonData>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: 'urlencoded',
	parsers: Parsers,
	options: BodyOptions,
): Promise<UrlencodedData>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: 'multipart',
	parsers: Parsers,
	options: BodyOptions,
): Promise<MultipartData>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: 'stream',
	parsers: Parsers,
	options: BodyOptions,
): Promise<Readable>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: 'text',
	parsers: Parsers,
	options: BodyOptions,
): Promise<string>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: 'raw',
	parsers: Parsers,
	options: BodyOptions,
): Promise<Buffer>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: BodyType,
	parsers: Parsers,
	options: BodyOptions,
): Promise<string | Buffer | JsonData | UrlencodedData | MultipartData | Readable>;
export async function parseBody(
	req: IncomingMessage,
	bodyType: BodyType,
	parsers: Parsers,
	options: BodyOptions,
): Promise<undefined | string | Buffer | JsonData | UrlencodedData | MultipartData | Readable> {
	if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
		return undefined;
	}

	if (!req.headers['content-type']) {
		throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
	}

	const { type, parameters } = contentType.parse(req);

	const parseOptions: rawBody.Options = {
		length: req.headers['content-length'],
		encoding: parameters.charset || 'utf-8',
		limit: options[bodyType]?.limit,
	};

	try {
		switch (bodyType) {
			case 'json':
			{
				if (BodyTypes[type] !== bodyType) {
					throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
				}

				const raw = await rawBody(req, parseOptions as { encoding: string });

				return parsers.json.parse(raw) as JsonData;
			}

			case 'urlencoded':
			{
				if (BodyTypes[type] !== bodyType) {
					throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
				}

				const raw = await rawBody(req, parseOptions as { encoding: string });

				return parsers.qs.parse(raw) as UrlencodedData;
			}

			case 'multipart':
			{
				if (BodyTypes[type] !== bodyType) {
					throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
				}

				const data = await parseMultipart(req, options.multipart);

				return data;
			}

			case 'stream':
				return req;

			case 'text': {
				if (!type.startsWith('text/')) {
					throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
				}

				const raw = await rawBody(req, parseOptions as { encoding: string });

				return raw;
			}

			case 'raw':
			default: {
				parseOptions.encoding = undefined;

				const raw = await rawBody(req, parseOptions as { encoding: undefined });

				return raw;
			}
		}
	} catch (err) {
		if (!(err instanceof HttpException)) {
			throw new HttpException(400, 'Bad Request', err);
		}

		throw err;
	}
}

export function parseCookie(req: IncomingMessage): Cookies {
	const { cookie } = req.headers;
	const cookies: Cookies = {};

	if (cookie && cookie !== '') {
		const cookieItems = cookie.split(';');

		for (const item of cookieItems) {
			const [name, value] = item.trim().split('=')
				.map(x => decodeURIComponent(x));

			if (cookies[name]) {
				cookies[name] = [cookies[name], value].flat();
			} else {
				cookies[name] = value;
			}
		}
	}

	return cookies;
}

export interface Cookies {
	[key: string]: string | string[];
}

export type BodyType = 'urlencoded' | 'json' | 'multipart' | 'text' | 'raw' | 'stream';

export interface BodyOptions extends Partial<Record<BodyType, { limit?: number | string }>> {
	multipart?: {
		limit?: number | string;
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
		stringify(value: { [key: string]: any }): string;
	};
}
