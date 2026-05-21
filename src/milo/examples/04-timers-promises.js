// milo-node: timers + promises working together
const start = Date.now();
function elapsed() { return ((Date.now() - start) / 1000).toFixed(2) + 's'; }

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function countdown(name, n, ms) {
  for (let i = n; i > 0; i--) {
    console.log(`  [${elapsed()}] ${name}: ${i}`);
    await delay(ms);
  }
  console.log(`  [${elapsed()}] ${name}: done`);
}

// run two countdowns concurrently
Promise.all([
  countdown('fast', 5, 100),
  countdown('slow', 3, 200),
]).then(() => {
  console.log(`  [${elapsed()}] all finished`);
});
