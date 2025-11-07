import { Contract } from '@algorandfoundation/tealscript'

export default class Simple extends Contract {
  counter = GlobalStateKey<uint64>({ key: 'counter' });

  incr(i: uint64): void {
    this.counter.value = this.counter.value + i;
  }
}