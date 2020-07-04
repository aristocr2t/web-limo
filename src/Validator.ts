/* eslint-disable @typescript-eslint/no-unsafe-call */
import { inspect } from 'util';

import { isEqual } from './utils';

export const ESCAPE_REPLACE_ARGS: [string | RegExp, string][] = [[/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]+/g, ''], [/[ \u0009\u00A0\u2000-\u200B\u202F\u205F\u2060\u3000\uFEFD-\uFEFF]+/g, ' ']];

export class ValidationError extends Error {
	constructor(
		readonly propertyPath: string | undefined,
		readonly value: any,
		readonly rule: DefaultValidationRule | DefaultValidationRule[]
	) {
		super(`${propertyPath} (${inspect(value)}) does not apply rule: ${inspect(rule)}`);
		Object.setPrototypeOf(this, ValidationError.prototype);
	}
}

export class Validator {
	static validate = <T>(x: T, rule: ValidationRule, propertyPath: string = 'this'): T | undefined => {
		if (Array.isArray(rule)) {
			for (const r of rule as PrimitiveValidationRule[]) {
				try {
					if (x === undefined) {
						if (r.default !== undefined) {
							if (typeof r.default === 'function') {
								return r.default(x, r) as T | undefined;
							}

							return r.default as T | undefined;
						}

						if (r.optional) {
							return undefined;
						}

						return Validator[r.type](x, r as any, propertyPath) as T;
					}

					const defaultValue = typeof r.default === 'function' ? r.default(x, r) : r.default;

					if (isEqual(x, defaultValue)) {
						return x;
					}

					return Validator[r.type](x, r as any, propertyPath) as T;
				} catch {}
			}

			throw new ValidationError(propertyPath, x, rule);
		}

		if (!rule) {
			throw new TypeError('ValidationRule is null or undefined');
		}

		if (x === undefined) {
			if (rule.default !== undefined) {
				if (typeof rule.default === 'function') {
					return rule.default(x, rule) as T | undefined;
				}

				return rule.default as T | undefined;
			}

			if (rule.optional) {
				return undefined;
			}

			return Validator[rule.type](x, rule as any, propertyPath) as T;
		}

		const defaultValue = typeof rule.default === 'function' ? rule.default(x, rule) : rule.default;

		if (isEqual(x, defaultValue)) {
			return x;
		}

		return Validator[rule.type](x, rule as any, propertyPath) as T;
	};

	private static boolean(x: any, rule: Partial<BooleanValidationRule>, propertyPath: string): boolean {
		if (x === true || rule.truthy?.includes(x)) {
			return true;
		}

		if (x === false || rule.falsy?.includes(x)) {
			return false;
		}

		throw new ValidationError(propertyPath, x, rule);
	}

	private static number(x: any, rule: Partial<NumberValidationRule>, propertyPath: string): number {
		if (!isFinite(x)) {
			throw new ValidationError(propertyPath, x, rule);
		}

		const num = +x;

		if (
			(rule.integer && !Number.isInteger(num))
			|| (isFinite(rule.min!) && num < (rule.min!))
			|| (isFinite(rule.max!) && num > (rule.max!))
			|| (rule.values && !rule.values.includes(num))
		) {
			throw new ValidationError(propertyPath, x, rule);
		}

		return num;
	}

	private static bigint(x: unknown, rule: Partial<BigintValidationRule>, propertyPath: string): bigint {
		if (!isFinite(x as number)) {
			throw new ValidationError(propertyPath, x, rule);
		}

		const num = BigInt(x);

		if (
			(isFinite(rule.min?.toString() as unknown as number) && num < (rule.min!))
			|| (isFinite(rule.max?.toString() as unknown as number) && num > (rule.max!))
		) {
			throw new ValidationError(propertyPath, x, rule);
		}

		return num;
	}

	private static string(x: unknown, rule: Partial<StringValidationRule>, propertyPath: string): string {
		if (typeof x === 'number') {
			x = x.toString();
		} else if (typeof x !== 'string') {
			throw new ValidationError(propertyPath, x, rule);
		}

		let str = x as string;

		if (
			(Number.isFinite(rule.length as number) && rule.length !== str.length)
			|| (Number.isFinite(rule.min!) && str.length < (rule.min!))
			|| (Number.isFinite(rule.max!) && str.length > (rule.max!))
			|| (rule.values && !rule.values.includes(str))
			|| (typeof rule.pattern === 'string' && !str.includes(rule.pattern))
			|| (rule.pattern instanceof RegExp && !rule.pattern.test(str))
		) {
			throw new ValidationError(propertyPath, x, rule);
		}

		if (rule.trim) {
			str = str.trim();
		}

		if (rule.escape! > 0) {
			for (let i = 0, len = ESCAPE_REPLACE_ARGS.length, lvl = rule.escape!; i <= lvl && i < len; i++) {
				str = str.replace(...ESCAPE_REPLACE_ARGS[i]);
			}
		}

		if (typeof rule.custom === 'function') {
			return rule.custom(str, rule);
		}

		return str as string;
	}

	private static date(x: unknown, rule: Partial<DateValidationRule>, propertyPath: string): Date | string {
		const date: Date = new Date(x as Date);

		if (isNaN(+date)) {
			throw new ValidationError(propertyPath, x, rule);
		}

		const num = +date;
		rule.min = new Date(rule.min as any);
		rule.max = new Date(rule.max as any);

		if ((!isNaN(+rule.min) && num < +rule.min) || (!isNaN(+rule.max) && num > +rule.max)) {
			throw new ValidationError(propertyPath, x, rule);
		}

		if (rule.dateonly) {
			return date.toISOString().substring(0, 10);
		}

		return date;
	}

	private static array(x: any, rule: Partial<ArrayValidationRule>, propertyPath: string): any[] {
		if (!Array.isArray(x)) {
			throw new ValidationError(propertyPath, x, rule);
		}

		let out = [];

		if (rule.nested) {
			if (Array.isArray(rule.nested)) {
				const { length } = rule.nested;

				if (x.length !== length) {
					throw new ValidationError(propertyPath, x, rule);
				}

				for (let i = 0; i < length; i++) {
					out.push(this.validate(x[i], rule.nested[i], `${propertyPath}[${i}]`));
				}
			} else {
				const nestedRule = rule.nested;

				for (let i = 0; i < x.length; i++) {
					out.push(this.validate(x[i], nestedRule, `${propertyPath}[${i}]`));
				}
			}
		} else {
			out = Array.from(x);
		}

		if (
			(Number.isFinite(rule.length as number) && rule.length !== out.length)
			|| (Number.isFinite(rule.min!) && out.length < (rule.min!))
			|| (Number.isFinite(rule.max!) && out.length > (rule.max!))
		) {
			throw new ValidationError(propertyPath, x, rule);
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return out;
	}

	private static object<T extends {}>(x: T, rule: Partial<ObjectValidationRule>, propertyPath: string): T {
		if (!x || typeof x !== 'object') {
			throw new ValidationError(propertyPath, x, rule);
		}

		const out = {} as T;

		if (rule.schema) {
			const entries = Object.entries(rule.schema);

			for (const [key, schemaRule] of entries) {
				out[key as keyof T] = this.validate(x[key as keyof T], schemaRule, `${propertyPath}.${key}`) as T[keyof T];
			}
		} else if (rule.nested) {
			const keys = Object.keys(x);

			for (const key of keys) {
				out[key as keyof T] = this.validate(x[key as keyof T], rule.nested, `${propertyPath}.${key}`) as T[keyof T];
			}
		}

		return x;
	}
}

export const { validate } = Validator;

export type ValidationSchema<T = any> = {
	[P in keyof T]: ValidationRule;
};

export type PrimitiveValidationRule =
| BooleanValidationRule
| StringValidationRule
| NumberValidationRule
| BigintValidationRule
| DateValidationRule
| ArrayValidationRule
| ObjectValidationRule;

export type ValidationRule =
| PrimitiveValidationRule
| PrimitiveValidationRule[];

export interface DefaultValidationRule<T = any> {
	default?: ((x: any, r: ValidationRule) => T | undefined) | T | undefined;
	optional?: boolean;
}

export interface BooleanValidationRule extends DefaultValidationRule {
	type: 'boolean';
	truthy?: any[];
	falsy?: any[];
}

export interface StringValidationRule extends DefaultValidationRule {
	type: 'string';
	min?: number;
	max?: number;
	length?: number;
	values?: string[];
	pattern?: string | RegExp;
	trim?: boolean;
	escape?: StringEscapeLevels;
	custom?(x: any, rule: Partial<StringValidationRule>): string;
}

export type StringEscapeLevels = 1 | 2;

export interface NumberValidationRule extends DefaultValidationRule {
	type: 'number';
	integer?: boolean;
	min?: number;
	max?: number;
	values?: number[];
}

export interface BigintValidationRule extends DefaultValidationRule {
	type: 'bigint';
	min?: bigint;
	max?: bigint;
}

export interface DateValidationRule extends DefaultValidationRule {
	type: 'date';
	min?: number | string | Date;
	max?: number | string | Date;
	dateonly?: boolean;
}

export interface ArrayValidationRule extends DefaultValidationRule {
	type: 'array';
	nested?: ValidationRule | ValidationRule[];
	length?: number;
	min?: number;
	max?: number;
}

export interface ObjectValidationRule extends DefaultValidationRule {
	type: 'object';
	nested?: ValidationRule;
	schema?: ValidationSchema;
}
