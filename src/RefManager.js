import { refSchema } from './schemas';
import Joi from 'joi';
import { operations, types } from './constants';
import pluralize from 'pluralize';

export default class RefManager {
  constructor(db) {
    this.db = db;
    this.events = {};
    this.references = {};

    Object.keys(operations).forEach((key) => {
      this.events[operations[key]] = {};
    });
  }

  on(operation, collection, handler) {
    if (!this.events[operation][collection]) {
      this.events[operation][collection] = [];
    }
    this.events[operation][collection].push(handler);
  }

  emit(operation, collection, ...rest) {
    return Promise.all(
      this.events[operation][collection].map((handler) => handler(...rest))
    );
  }

  parseRefConfig(config) {
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
      parsedConfig.ns = `_${destinationPropr}${type === types.many ? 's' : ''}`;
      parsedConfig.ns = `_${type === types.many ? pluralize(destinationPropr) : destinationPropr}`;
    }

    return parsedConfig;
  }

  add(config) {
    const {
      source, destination, refProperty, type, ns, extractor,
    } = this.parseRefConfig(config);

    if (!this.references[source]) {
      this.references[source] = {};
    }

    this.references[source][refProperty] = {
      collection: destination,
      type,
      ns,
      extractor,
    };

    this.onInsert({ source });

    this.onUpdate({ source, destination, refProperty, extractor, type, ns });

    this.onRemove({ source, destination, refProperty, ns });

    return this;
  }

  getRefsIds({ docs, refPropsList }) {
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

  async getRefsList({ refsIds, refsConfig }) {
    return await Promise.all(
      Object.keys(refsIds).map((refPropr) => {
        const refCollectionName = refsConfig[refPropr].collection;
        return this.db.collection(refCollectionName).find({
          _id: {
            $in: refsIds[refPropr],
          },
        }).toArray();
      })
    );
  }

  getDocUpdatePayload({ doc, refsConfig, refsMap }) {
    return Object.keys(refsConfig).reduce((acc, refPropr) => {
      const refConfig = refsConfig[refPropr];
      let update;
      if (refConfig.type === types.one) {
        update = refConfig.extractor(
          refsMap[refPropr].find(({ _id }) => doc[refPropr].toString() === _id.toString())
        );
      } else {
        update = doc[refPropr].reduce((r, id) => ({
          ...r,
          [id.toString()]:
            refsMap[refPropr].find(({ _id }) => id.toString() === _id.toString()),
        }), {});
      }

      return {
        ...acc,
        [refConfig.ns]: update,
      };
    }, {});
  }

  onInsert({ source }) {
    this.on(operations.insert, source, async ({ data }) => {
      const docs = Array.isArray(data) ? data : [data];

      const refsConfig = this.references[source];
      const refPropsList = Object.keys(refsConfig);

      const refsIds = this.getRefsIds({ docs, refPropsList });

      const refsList = await this.getRefsList({ refsIds, refsConfig });

      const refsMap = refPropsList.reduce((acc, refPropr, index) => ({
        ...acc,
        [refPropr]: refsList[index],
      }), {});

      const bulk = this.db.collection(source).initializeUnorderedBulkOp();
      docs.forEach((doc) => {
        bulk.find({ _id: doc._id }).updateOne({
          $set: this.getDocUpdatePayload({ doc, refsConfig, refsMap }),
        });
      });

      return bulk.execute();
    });
  }

  onUpdate({ source, destination, refProperty, extractor, type, ns }) {
    this.on(operations.update, destination, async ({ query }) => {
      const refDocs = await this.db.collection(destination).find(query).toArray();
      const bulk = this.db.collection(source).initializeUnorderedBulkOp();

      refDocs.forEach((doc) => {
        const updateNS = type === types.one ? ns : `${ns}.${doc._id}`;

        bulk.find({
          [refProperty]: doc._id,
        }).update({
          $set: {
            [updateNS]: extractor(doc),
          },
        });
      });

      return bulk.execute();
    });
  }

  onRemove({ source, destination, refProperty, ns }) {
    this.on(operations.remove, destination, async ({ query }) => {
      const refDocs = await this.db.collection(destination).find(query, { _id: 1 }).toArray();
      const refDocsIds = refDocs.map(({ _id }) => _id);
      return this.db.collection(source).update({
        [refProperty]: {
          $in: refDocsIds,
        },
      }, {
        $unset: {
          [ns]: '',
        },
      });
    });
  }

  notify(options) {
    const { operation, collection, ...rest } = options;
    return this.emit(operation, collection, rest);
  }

  notifyInsert(collection, data) {
    return this.notify({
      operation: operations.insert,
      collection,
      data,
    });
  }

  notifyUpdate(collection, query) {
    return this.notify({
      operation: operations.update,
      collection,
      query,
    });
  }

  notifyRemove(collection, query) {
    return this.notify({
      operation: operations.remove,
      collection,
      query,
    });
  }
}
