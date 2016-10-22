import { refSchema } from './schemas';
import { types } from './constants';
import Joi from 'joi';
import pluralize from 'pluralize';

export default class RefStore extends Map {
  static parseRefConfig(config) {
    const parsedConfig = Joi.attempt(config, refSchema);
    const { destination, type } = parsedConfig;
    const destinationPropr = `${destination[0].toLowerCase()}${destination.slice(1)}`;

    if (!parsedConfig.refProperty) {
      parsedConfig.refProperty = `${destinationPropr}Id`;
      if (type === types.many) {
        parsedConfig.refProperty += 's';
      }
    }

    if (!parsedConfig.ns) {
      parsedConfig.ns = `_${type === types.many ? pluralize(destinationPropr) : destinationPropr}`;
    }

    return parsedConfig;
  }

  static getRefsIds({ docs, refPropsList }) {
    const refsPropsMap = refPropsList.reduce((acc, refPropr) => ({
      ...acc,
      [refPropr]: [],
    }), {});

    return docs.reduce((map, doc) => {
      refPropsList.forEach((refPropr) => {
        if (doc[refPropr]) {
          if (Array.isArray(doc[refPropr])) {
            map[refPropr].push(...doc[refPropr]);
          } else {
            map[refPropr].push(doc[refPropr]);
          }
        }
      });

      return map;
    }, refsPropsMap);
  }

  static async getRefsList({ db, refsIds, refsConfig }) {
    return await Promise.all(
      Object.keys(refsIds).map((refPropr) => {
        const refCollectionName = refsConfig[refPropr].collection;
        return db.collection(refCollectionName).find({
          _id: {
            $in: refsIds[refPropr],
          },
        }).toArray();
      })
    );
  }

  static getDocUpdatePayload({ doc, refsConfig, refsMap }) {
    return Object.keys(refsConfig).reduce((acc, refPropr) => {
      const refConfig = refsConfig[refPropr];
      let update;
      if (refConfig.type === types.one) {
        update = refConfig.extractor(
          refsMap[refPropr].find(({ _id }) => doc[refPropr].toString() === _id.toString())
        );
      } else if (Array.isArray(doc[refPropr])) {
        update = doc[refPropr].reduce((r, id) => ({
          ...r,
          [id.toString()]: refConfig.extractor(
            refsMap[refPropr].find(({ _id }) => id.toString() === _id.toString())
          ),
        }), {});
      }

      if (!update) {
        return acc;
      }

      return {
        ...acc,
        [refConfig.ns]: update,
      };
    }, {});
  }

  add(config) {
    const {
      source, destination, refProperty, type, ns, extractor,
    } = RefStore.parseRefConfig(config);

    if (!this.has(source)) {
      this.set(source, {});
    }

    this.get(source)[refProperty] = {
      collection: destination,
      type,
      ns,
      extractor,
      // syncOn: ['update', 'delete'],
    };

    return this;
  }
}
