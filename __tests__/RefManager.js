import RefManager from '../src/RefManager';
import { MongoClient } from 'mongodb';

describe('Octobus', () => {
  let rm;
  let db;

  beforeAll(() => ( // eslint-disable-line
    MongoClient.connect('mongodb://localhost:27017/mdnorm').then((_db) => {
      db = _db;
      rm = new RefManager(db);

      rm
        .add({
          source: 'Product',
          destination: 'Category',
          extractor: ({ name }) => ({ name }),
        })
        .add({
          source: 'Category',
          destination: 'Product',
          type: 'many',
          extractor: ({ name }) => ({ name }),
        });
    })
  ));

  afterAll(() => { // eslint-disable-line
    db.close();
  });

  beforeEach(() => (
    Promise.all([
      db.collection('Category').remove(),
      db.collection('Product').remove(),
    ]).then(async () => {
      await db.collection('Category').insert([
        { _id: 1, name: 'category1', productIds: [1] },
        { _id: 2, name: 'category2', productIds: [2] },
        { _id: 3, name: 'category3' },
        { _id: 4, name: 'category4', productIds: [3, 4] },
      ]);

      await db.collection('Product').insert([
        { _id: 1, name: 'product1', categoryId: 1 },
        { _id: 2, name: 'product2', categoryId: 2 },
        { _id: 3, name: 'product3', categoryId: 4 },
        { _id: 4, name: 'product4', categoryId: 4 },
      ]);

      await rm.syncAll();
    })
  ));

  it('stores the references configuration', () => {
    expect(rm.references).toMatchSnapshot();
  });

  describe('it should populate the cache after insert', () => {
    it('for type=one reference', async () => {
      const productsWithReferences = await db.collection('Product').find().toArray();
      expect(productsWithReferences).toMatchSnapshot();
    });

    it('for type=many reference', async () => {
      const categoriesWithReferences = await db.collection('Category').find().toArray();
      expect(categoriesWithReferences).toMatchSnapshot();
    });
  });

  describe('sync cache after an update', () => {
    it('for type=one reference', async () => {
      const q = {
        _id: 4,
      };
      await db.collection('Category').updateOne(q, {
        $set: {
          name: 'category 4 updated',
        },
      });

      await rm.notifyUpdate('Category', q);
      const refProducs = await db.collection('Product').find({ categoryId: 4 }).toArray();
      expect(refProducs).toMatchSnapshot();
    });

    it('for type=many reference', async () => {
      const q = {
        _id: {
          $in: [3, 4],
        },
      };
      await db.collection('Product').updateMany(q, {
        $set: {
          name: 'update product name',
        },
      });

      await rm.notifyUpdate('Product', q);
      const refCategories = await db.collection('Category').find({
        productIds: { $in: [3, 4] },
      }).toArray();
      expect(refCategories).toMatchSnapshot();
    });
  });

  describe('sync cache after delete', () => {
    it('for type=one reference', async () => {
      const q = {
        _id: 4,
      };
      await rm.notifyRemove('Category', q);
      await db.collection('Category').removeOne(q);

      const refProducs = await db.collection('Product').find().toArray();
      expect(refProducs).toMatchSnapshot();
    });

    it('for type=many reference', async () => {
      const q = {
        _id: 3,
      };
      await rm.notifyRemove('Product', q);
      await db.collection('Product').removeOne(q);

      const refCategories = await db.collection('Category').find().toArray();
      expect(refCategories).toMatchSnapshot();
    });
  });
});
