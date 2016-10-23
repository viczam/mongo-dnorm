import { operations, types } from './constants';
import RefStore from './RefStore';
import Events from './Events';

export default class RefManager {
  constructor(db) {
    this.db = db;
    this.events = new Events();
    this.references = new RefStore();
  }

  add(rawConfig) {
    const config = RefStore.parseRefConfig(rawConfig);

    this.references.add(config);

    if (config.syncOn.includes(operations.update)) {
      this.onUpdate(config);
    }

    if (config.syncOn.includes(operations.remove)) {
      this.onRemove(config);
    }

    return this;
  }

  async sync({ collection, references, data, cursor }) {
    if (cursor) {
      const result = [];
      while (await cursor.hasNext()) {
        const next = await cursor.next();
        const res = await this.sync({ collection, references, data: next });
        result.push(res);
      }

      return result;
    }

    const docs = Array.isArray(data) ? data : [data];
    const refsConfig = this.references.get(collection);
    const refPropsList = Array.isArray(references) ? references : Object.keys(refsConfig);
    const refsIds = RefStore.getRefsIds({ docs, refPropsList });
    const refsList = await RefStore.getRefsList({ db: this.db, refsIds, refsConfig });
    const refsMap = refPropsList.reduce((acc, refPropr, index) => ({
      ...acc,
      [refPropr]: refsList[index],
    }), {});

    const bulk = this.db.collection(collection).initializeUnorderedBulkOp();
    let hasOperations = false;
    docs.forEach((doc) => {
      const updatePayload = RefStore.getDocUpdatePayload({ doc, refsConfig, refsMap });
      const hasUpdates = Object.keys(updatePayload).length;
      if (hasUpdates) {
        hasOperations = true;
        bulk.find({ _id: doc._id }).updateOne({
          $set: updatePayload,
        });
      }
    });

    if (hasOperations) {
      return bulk.execute();
    }

    return Promise.resolve(false);
  }

  async syncAll({ collections }) {
    if (!collections) {
      collections = Array.from(this.references.getCollections()); // eslint-disable-line
    }

    return Promise.all(
      collections.map(
        (collection) => this.sync({ collection, cursor: this.db.collection(collection).find() })
      )
    );
  }

  onUpdate({ source, destination, refProperty, extractor, type, ns }) {
    this.events.on(operations.update, destination, async ({ query }) => {
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
        }, {
          multi: true,
        });
      });

      return bulk.execute();
    });
  }

  onRemove({ source, destination, refProperty, type, ns }) {
    this.events.on(operations.remove, destination, async ({ query }) => {
      const refDocs = await this.db.collection(destination).find(query, { _id: 1 }).toArray();
      const refDocsIds = refDocs.map(({ _id }) => _id);
      const updatePayload = {
        $unset: {},
      };

      if (type === types.one) {
        updatePayload.$unset[ns] = '';
      } else {
        refDocsIds.forEach((id) => {
          updatePayload.$unset[`${ns}.${id}`] = '';
        });
      }

      return this.db.collection(source).update({
        [refProperty]: {
          $in: refDocsIds,
        },
      }, updatePayload, {
        multi: true,
      });
    });
  }

  notifyUpdate(collection, query) {
    return this.events.notify({
      operation: operations.update,
      collection,
      query,
    });
  }

  notifyRemove(collection, query) {
    return this.events.notify({
      operation: operations.remove,
      collection,
      query,
    });
  }
}
