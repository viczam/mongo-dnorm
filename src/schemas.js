import Joi from 'joi';
import { types, operations } from './constants';
import values from 'lodash/values';

export const refSchema = Joi.object().keys({
  source: Joi.string().required(),
  destination: Joi.string().required(),
  refProperty: Joi.string(),
  type: Joi.string().valid(values(types)).default(types.one),
  ns: Joi.string(),
  extractor: Joi.func().default((item) => item),
  syncOn: Joi.array().items(Joi.string().valid(values(operations))).default(values(operations)),
});
