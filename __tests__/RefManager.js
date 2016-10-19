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

      rm.add({
        source: 'Product',
        destination: 'Category',
        extractor: ({ name }) => ({ name }),
      });

      rm.add({
        source: 'Category',
        destination: 'Product',
        type: 'many',
        extractor: ({ name }) => ({ name }),
      });

      categories = (await db.collection('Category').insert([
        { name: 'category1' },
        { name: 'category2' },
        { name: 'category3' },
        { name: 'category4' },
      ])).ops;

      products = (await db.collection('Product').insert([
        { name: 'product1', categoryId: categories[0]._id },
        { name: 'product2', categoryId: categories[1]._id },
        { name: 'product3', categoryId: categories[3]._id },
        { name: 'product4', categoryId: categories[3]._id },
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
      const productsWithReferences = (await db.collection('Product').find().toArray())
        .map(({ _category, name }) => ({
          _category,
          name,
        }));

      expect(productsWithReferences).toMatchSnapshot();
    });

    it('for type=many reference', async () => {
      await rm.notifyInsert('Category', categories);
      const categoriesWithReferences = await db.collection('Category').find().toArray();
      const firstCategory = categoriesWithReferences.find(({ name }) => name === 'category1');
      const fourthCategory = categoriesWithReferences.find(({ name }) => name === 'category4');
      expect(firstCategory._products).toBeDefined();
      expect(firstCategory._products[products[0]._id.toString()]).toEqual({
        name: 'product1',
      });
      expect(fourthCategory._products).toBeDefined();
      expect(fourthCategory._products).toEqual({
        [products[2]._id.toString()]: {
          name: 'product3',
        },
        [products[3]._id.toString()]: {
          name: 'product4',
        },
      });
    });
  });
});
