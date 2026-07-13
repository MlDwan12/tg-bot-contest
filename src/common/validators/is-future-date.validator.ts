import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (!value) return false;

          const date = value instanceof Date ? value : new Date(value);

          if (Number.isNaN(date.getTime())) return false;

          return date.getTime() >= Date.now();
        },
      },
    });
  };
}
