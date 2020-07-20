/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { inspect } from 'util';

import type { ArrayRule, BooleanRule, DateRule, NumberRule, ObjectRule, PrimitiveRule, StringRule, ValidationRule } from './types';
import { isEqual } from './utils';

export const ESCAPE_REPLACE_ARGS: [string | RegExp, string][] = [
	[/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]+/g, ''],
	[/[ \u0009\u00A0\u2000-\u200B\u202F\u205F\u2060\u3000\uFEFD-\uFEFF]+/g, ' '],
];

export class ValidationError extends Error {
	constructor(
		readonly propertyPath: string,
		readonly value: any,
		readonly rule: ValidationRule,
	) {
		super(`${propertyPath} ${inspect(value)} does not apply rule ${inspect(rule)}`);
		Object.setPrototypeOf(this, ValidationError.prototype);
	}
}

export class Validator {
	static validate = (x: unknown, rule: ValidationRule, propertyPath: string = 'this', isQuery?: boolean): any => {
		if (Array.isArray(rule)) {
			for (const r of rule) {
				try {
					return Validator.resolve(x, r, propertyPath, isQuery);
				} catch {}
			}

			throw new ValidationError(propertyPath, x, rule);
		}

		return Validator.resolve(x, rule, propertyPath, isQuery);
	};

	protected static resolve(x: unknown, rule: PrimitiveRule, propertyPath: string, isQuery?: boolean): any {
		if (!rule) {
			throw new TypeError('Rule is null or undefined');
		}

		if (x === null || x === undefined || (isQuery && x === '' && rule.type !== 'string')) {
			if (rule.default !== undefined) {
				x = typeof rule.default === 'function' ? rule.default(x, rule) : rule.default;

				if (rule.parse) {
					return rule.parse(x, rule);
				}

				return x;
			}

			if (rule.optional) {
				return undefined;
			}

			throw new ValidationError(propertyPath, x, rule);
		}

		if (rule.default !== undefined) {
			const defaultValue = typeof rule.default === 'function' ? rule.default(x, rule) : rule.default;

			if (isEqual(x, defaultValue)) {
				if (rule.parse) {
					return rule.parse(x, rule);
				}

				return x;
			}
		}

		x = Validator[rule.type](x, rule as any, propertyPath, isQuery);

		if (rule.parse) {
			return rule.parse(x, rule);
		}

		return x;
	}

	static boolean(x: unknown, rule: Partial<BooleanRule>, propertyPath: string, isQuery?: boolean): boolean {
		if (x === true || (isQuery && x === '1') || rule.truthy?.includes(x)) {
			return true;
		}

		if (x === false || (isQuery && x === '0') || rule.falsy?.includes(x)) {
			return false;
		}

		throw new ValidationError(propertyPath, x, rule as BooleanRule);
	}

	static number(x: unknown, rule: Partial<NumberRule>, propertyPath: string): number {
		if (!isFinite(x as number) || x === '') {
			throw new ValidationError(propertyPath, x, rule as NumberRule);
		}

		let num = +(x as number);

		if (Number.isFinite(rule.digits!) && rule.digits! > 0) {
			const m = 10 ** +rule.digits!;
			const roundingFn = Math[rule.roundingFn || 'round'];

			num = roundingFn(num * m) / m;
		}

		if (
			(rule.integer && !Number.isInteger(num))
			|| (Number.isFinite(rule.min) && num < rule.min!)
			|| (Number.isFinite(rule.max) && num > rule.max!)
			|| (rule.values && !rule.values.includes(num))
		) {
			throw new ValidationError(propertyPath, x, rule as NumberRule);
		}

		return num;
	}

	static string(x: unknown, rule: Partial<StringRule>, propertyPath: string): string {
		if (typeof x === 'number') {
			x = x.toString();
		} else if (typeof x !== 'string') {
			throw new ValidationError(propertyPath, x, rule as StringRule);
		}

		let str = x as string;

		if (rule.trim) {
			str = str.trim();
		}

		if (rule.escape! > 0) {
			for (let i = 0, len = ESCAPE_REPLACE_ARGS.length, lvl = rule.escape!; i <= lvl && i < len; i++) {
				str = str.replace(...ESCAPE_REPLACE_ARGS[i]);
			}
		}

		if (
			(Number.isFinite(rule.length as number) && rule.length !== str.length)
			|| (Number.isFinite(rule.min!) && str.length < (rule.min!))
			|| (Number.isFinite(rule.max!) && str.length > (rule.max!))
			|| (rule.values && !rule.values.includes(str))
			|| (typeof rule.pattern === 'string' && !str.includes(rule.pattern))
			|| (rule.pattern instanceof RegExp && !rule.pattern.test(str))
		) {
			throw new ValidationError(propertyPath, x, rule as StringRule);
		}

		return str as string;
	}

	static date(x: unknown, rule: Partial<DateRule>, propertyPath: string): Date {
		const ts: number = +new Date(x as Date);

		if (isNaN(ts)) {
			throw new ValidationError(propertyPath, x, rule as DateRule);
		}

		const min = +new Date(typeof rule.min === 'function' ? rule.min() : rule.min!);
		const max = +new Date(typeof rule.max === 'function' ? rule.max() : rule.max!);

		if ((isFinite(min) && ts < min) || (isFinite(max) && ts > max)) {
			throw new ValidationError(propertyPath, x, rule as DateRule);
		}

		return new Date(ts);
	}

	static array(x: unknown, rule: Partial<ArrayRule>, propertyPath: string, isQuery?: boolean): any[] {
		if (
			!Array.isArray(x)
			|| (Number.isFinite(rule.length) && rule.length !== x.length)
			|| (Number.isFinite(rule.min) && x.length < rule.min!)
			|| (Number.isFinite(rule.max) && x.length > rule.max!)
		) {
			throw new ValidationError(propertyPath, x, rule as ArrayRule);
		}

		let out: any[] = [];

		if (rule.nested) {
			const nestedRule = rule.nested;

			for (let i = 0, len = x.length, v: any; i < len; i++) {
				v = this.validate(x[i], nestedRule, `${propertyPath}[${i}]`, isQuery);

				if (v) {
					out.push(v);
				}
			}
		} else {
			out = Array.from(x);
		}

		return out;
	}

	static object(x: unknown, rule: Partial<ObjectRule>, propertyPath: string, isQuery?: boolean): object {
		if (!x || typeof x !== 'object') {
			throw new ValidationError(propertyPath, x, rule as ObjectRule);
		}

		const out = {};

		if (rule.schema) {
			const entries = Object.entries(rule.schema);

			for (const [key, schemaRule] of entries) {
				(out as { [key: string]: any })[key] = this.validate((x as { [key: string]: any })[key], schemaRule, `${propertyPath}.${key}`, isQuery);
			}
		} else if (rule.nested) {
			const keys = Object.keys(x as any);
			const nestedRule = rule.nested;

			for (const key of keys) {
				(out as { [key: string]: any })[key] = this.validate((x as { [key: string]: any })[key], nestedRule, `${propertyPath}.${key}`, isQuery);
			}
		}

		return out;
	}
}

export const { validate } = Validator;
