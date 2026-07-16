// EXPECT_EXIT=0 — passes today: unrefd timers don't hold loop
const t = setTimeout(() => console.log('SHOULD NOT FIRE'), 2000); t.unref();
const i = setInterval(() => {}, 500); i.unref();
console.log('unrefd');
