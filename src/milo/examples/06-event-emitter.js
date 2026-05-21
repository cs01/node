// milo-node: custom event emitter — a tiny job queue
const EventEmitter = require('events');

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.running = false;
  }

  add(name, work) {
    this.queue.push({ name, work });
    this.emit('queued', name);
    if (!this.running) this._next();
  }

  _next() {
    if (this.queue.length === 0) {
      this.running = false;
      this.emit('idle');
      return;
    }
    this.running = true;
    const job = this.queue.shift();
    this.emit('start', job.name);

    setTimeout(() => {
      const result = job.work();
      this.emit('done', job.name, result);
      this._next();
    }, 50);
  }
}

const q = new JobQueue();

q.on('queued', (name) => console.log(`  + queued: ${name}`));
q.on('start', (name) => console.log(`  > running: ${name}`));
q.on('done', (name, result) => console.log(`  ✓ ${name} => ${result}`));
q.on('idle', () => console.log('  ~ queue idle'));

q.add('fib(30)', () => { let a=0,b=1; for(let i=0;i<30;i++){[a,b]=[b,a+b];} return b; });
q.add('sum(1..100)', () => { let s=0; for(let i=1;i<=100;i++) s+=i; return s; });
q.add('reverse', () => 'milo-node'.split('').reverse().join(''));
q.add('env.USER', () => process.env.USER || process.env.HOME);
