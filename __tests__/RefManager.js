import RefManager from '../src/RefManager';
import { MongoClient } from 'mongodb';

describe('Octobus', () => {
  let rm;
  let db;
  let products;
  let categories;

  beforeAll(() => (
    MongoClient.connect('mongodb://localhost:27017/mdnorm').then((_db) => {
      db = _db;
    })
  ));

  afterAll(() => {
    db.close();
  });

  beforeEach(() => (
    db.dropDatabase().then(async () => {
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

      categories = (await db.collection('Category').insert([
        { _id: 1, name: 'category1' },
        { _id: 2, name: 'category2' },
        { _id: 3, name: 'category3' },
        { _id: 4, name: 'category4' },
      ])).ops;

      products = (await db.collection('Product').insert([
        { _id: 1, name: 'product1', categoryId: categories[0]._id },
        { _id: 2, name: 'product2', categoryId: categories[1]._id },
        { _id: 3, name: 'product3', categoryId: categories[3]._id },
        { _id: 4, name: 'product4', categoryId: categories[3]._id },
      ])).ops;

      await Promise.all([
        await db.collection('Category').update({
          _id: categories[0]._id,
        }, {
          $set: {
            productIds: [products[0]._id],
          },
        }),
        await db.collection('Category').update({
          _id: categories[1]._id,
        }, {
          $set: {
            productIds: [products[1]._id],
          },
        }),
        await db.collection('Category').update({
          _id: categories[3]._id,
        }, {
          $set: {
            productIds: [products[2]._id, products[3]._id],
          },
        }),
      ]);

      categories = await db.collection('Category').find().toArray();
    })
  ));

  it('stores the references configuration', () => {
    expect(rm.references).toMatchSnapshot();
  });

  describe('it should populate the cache after insert', () => {
    it('for type=one reference', async () => {
      await rm.notifyInsert('Product', products);
      const productsWithReferences = await db.collection('Product').find().toArray();
      expect(productsWithReferences).toMatchSnapshot();
    });

    it('for type=many reference', async () => {
      await rm.notifyInsert('Category', categories);
      const categoriesWithReferences = await db.collection('Category').find().toArray();
      expect(categoriesWithReferences).toMatchSnapshot();
    });
  });
});
