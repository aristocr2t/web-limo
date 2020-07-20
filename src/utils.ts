/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as contentType from 'content-type';
import { IncomingForm } from 'formidable';
import type { IncomingMessage } from 'http';
import { join as pathJoin } from 'path';
import type { Readable } from 'stream';

import { BodyOptions, BodyType, Cookies, File, JsonData, MultipartData, MultipartOptions, Parsers, UrlencodedData } from './types';

const unpipe = require('unpipe') as (stream: Readable) => void;

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

function parseMultipart(req: IncomingMessage, options: MultipartOptions = {}): Promise<MultipartData> {
	return new Promise<MultipartData>((resolve, reject) => {
		if (!options.uploadDir) {
			options.uploadDir = 'tmp';
		}

		if (typeof options.keepExtensions !== 'boolean') {
			options.keepExtensions = true;
		}

		const form = new IncomingForm(options as any);

		if (options.filename) {
			(form as unknown as IncomingForm & { _uploadPath(this: IncomingForm, filename: string): string })._uploadPath = function(filename: string): string {
				const name = options.filename!(filename);

				return pathJoin(this.uploadDir, name);
			};
		}

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

function halt(stream: Readable): void {
	unpipe(stream);

	if (typeof stream.pause === 'function') {
		stream.pause();
	}
}

function readBody(req: IncomingMessage, encoding: string, limit?: number): Promise<string>;
function readBody(req: IncomingMessage, encoding: undefined, limit?: number): Promise<Buffer>;
function readBody(req: IncomingMessage, encoding?: string | undefined, limit?: number): Promise<Buffer | string> {
	return new Promise<Buffer | string>((resolve, reject) => {
		const contentLength = req.headers['content-length'];
		const length = contentLength === undefined ? undefined : +contentLength;

		let complete = false;

		if (typeof encoding === 'string' && encoding !== 'utf-8') {
			return reject(new HttpException(415, 'specified encoding unsupported', { encoding }));
		}

		// check the length and limit options.
		// note: we intentionally leave the stream paused,
		// so users should handle the stream themselves.
		if (length! > limit!) {
			halt(req);

			return reject(new HttpException(413, 'request entity too large', {
				expected: length,
				limit,
			}));
		}

		// streams1: assert request encoding is buffer.
		// streams2+: assert the stream encoding is buffer.
		//   stream._decoder: streams1
		//   state.encoding: streams2
		//   state.decoder: streams2, specifically < 0.10.6
		const state = (req as any)._readableState;

		if ((req as any)._decoder || (state && (state.encoding || state.decoder))) {
			halt(req);

			return reject(new HttpException(500, 'stream encoding should not be set', {}));
		}

		let received = 0;

		const data: Buffer[] = [];

		function cleanup(throwed?: boolean): void {
			if (complete) return;

			complete = true;

			if (throwed) {
				halt(req);
			}

			req.removeListener('aborted', onAborted);
			req.removeListener('data', onData);
			req.removeListener('end', onEnd);
			req.removeListener('error', onEnd);
			req.removeListener('close', cleanup);
		}

		function onAborted(): void {
			if (complete) return;

			cleanup(true);

			return reject(new HttpException(400, 'request aborted', {
				code: 'ECONNABORTED',
				expected: length,
				received,
			}));
		}

		function onData(chunk: Buffer): void {
			if (complete) return;

			received += chunk.length;

			if (received > limit!) {
				cleanup(true);

				return reject(new HttpException(413, 'request entity too large', {
					limit,
					received,
				}));
			}

			data.push(chunk);
		}

		function onEnd(err: Error): void {
			if (complete) return;

			if (err || received !== length!) {
				cleanup(true);

				return reject(err || new HttpException(400, 'request size did not match content length', {
					expected: length,
					received,
				}));
			}

			cleanup();

			const buffer = Buffer.concat(data);

			return resolve(typeof encoding === 'string' ? buffer.toString(encoding as 'utf-8') : buffer);
		}

		req.on('aborted', onAborted);
		req.on('close', cleanup);
		req.on('data', onData);
		req.on('end', onEnd);
		req.on('error', onEnd);
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

	const limit = options[bodyType]?.limit;
	const encoding = parameters.charset || 'utf-8';

	try {
		switch (bodyType) {
			case 'json':
			{
				if (BodyTypes[type] !== bodyType) {
					throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
				}

				const raw = await readBody(req, encoding, limit);

				return parsers.json.parse(raw) as JsonData;
			}

			case 'urlencoded':
			{
				if (BodyTypes[type] !== bodyType) {
					throw new HttpException(400, undefined, new Error('Incorrect header "Content-Type"'));
				}

				const raw = await readBody(req, encoding, limit);

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

				const raw = await readBody(req, encoding, limit);

				return raw;
			}

			case 'raw':
			default: {
				const raw = await readBody(req, undefined, limit);

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
