import { operations } from './constants';

export default class Events extends Map {
  constructor() {
    super();
    Object.keys(operations).forEach((key) => {
      this.set(operations[key], {});
    });
  }

  on(operation, collection, handler) {
    if (!this.get(operation)[collection]) {
      this.get(operation)[collection] = [];
    }
    this.get(operation)[collection].push(handler);
  }

  emit(operation, collection, ...rest) {
    return Promise.all(
      this.get(operation)[collection].map((handler) => handler(...rest))
    );
  }

  notify(options) {
    const { operation, collection, ...rest } = options;
    return this.emit(operation, collection, rest);
  }
}
