// TODO: Add and configure failure rate, delay timing, job spawning, dynamic workers
let tenants = [];
let jobs = [];
let delayedJobs = [];
let workers = [];
let semaphoreSize = 1;
let tickSize = 50;
let tickCount = 0;
let id = 1;
let running = false;
let stopWhenEmpty = true;
let requeueWhenBlocked = false;
let requeueWithDelay = false;
let randomDelay = false;

let chartData = [[0], [0], [0]];
let chartElem;
let chart;

const root = document.getElementById('root');

const TenantComponent = {
  view(vnode) {
    const { tenant } = vnode.attrs;
    return m('form', { 'data-tenant-form': true, onsubmit: addJobsFromTenant },
      m('div', { style: `width: 32px; height: 32px; background-color: ${tenant.color};` }),
      m('input', { name: 'color', type: 'hidden', value: tenant.color }),
      m('input', { name: 'count', type: 'number', min: 1, max: 100, step: 1, style: 'width: 50px' }),
      m('input', { type: 'submit', value: 'Add Jobs' }),
    );
  }
};

const JobComponent = {
  view(vnode) {
    const { job } = vnode.attrs;
    const size = vnode.attrs.size ?? 64;
    return m('div', { style: `width: ${size}px; height: ${size}px; background-color: ${job.color}; border: 1px solid black; overflow: hidden; position: relative;` },
      m('div', { style: 'display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: white; background-color: black; position: absolute; top: 0; right: 0; font-size: 12px;' }, job.effort),
    );
  }
};

const QueueComponent = {
  view(vnode) {
    const { jobs } = vnode.attrs;
    return m('div', { style: 'margin-top: 1rem; display: flex; height: 96px; border: 1px solid black;' }, jobs.map(job => m(JobComponent, { job, key: job.id })));
  }
};

const DelayQueuesComponent = {
  view(vnode) {
    const { delayedJobs } = vnode.attrs;
    const grouped = [];
    delayedJobs.forEach(dj => {
      grouped[dj.ticks] ||= 0;
      grouped[dj.ticks] += 1;
    });
    return m('div', grouped.map((count, index) => {
      return m('span', { style: 'border: 1px solid black; margin-right: 1rem;' }, index + ': ' + count);
    }));
  }
};

const WorkerComponent = {
  view(vnode) {
    const { worker } = vnode.attrs;
    const { job, blocked } = worker;
    return m('div', { style: `width: 96px; height: 96px; display: flex; justify-content: center; align-items: center; border: 1px solid black; background-color: ${blocked ? '#ffcccc' : job ? '#ccffcc' : ''}` },
      job && m('div',
        m('progress', { value: worker.ticks, max: job.effort, style: `width: 64px; height: 8px;` }),
        m(JobComponent, { job })
      ),
    );
  }
};

function sample(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function addTenant(color) {
  color = '#'+(Math.random()*0xFFFFFF<<0).toString(16);
  tenants.push({ color });

  chart.addSeries({
    label: color,
    stroke: color,
    width: 1,
  });

  chartData.push(Array(tickCount).fill(null));
}

function addWorker() {
  workers.push({ ticks: 0, blocked: false });
  chartData[1][tickCount] += 1;
  chart.setData(chartData);
}

function newJob(color) {
  return { id: id++, color, effort: 20 + Math.ceil(Math.random() * 20) };
}

function save() {
  localStorage.saved = JSON.stringify({
    tickCount,
    tenants,
    delayedJobs,
    jobs,
    workers,
    chartData,
  })
}

function load() {
  const data = JSON.parse(localStorage.saved ?? '{}');
  tickCount = data.tickCount ?? 0;
  tenants = data.tenants ?? [];
  delayedJobs = data.delayedJobs ?? [];
  jobs = data.jobs ?? [];
  workers = data.workers ?? [];
  chartData = data.chartData ?? [[0], [0], [0]];

  chart.destroy();
  prepareChart(document.getElementById('chart'));
}

function addJobsFromTenant(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const count = parseInt(data.get('count') || '0');
  const color = data.get('color');
  for (let i = 0; i < count; i++) {
    jobs.push(newJob(color));
  }

  const offset = 3;
  const tenantIndex = tenants.findIndex((t) => t.color === color);
  const currentCount = chartData[tenantIndex + offset][tickCount] ?? 0;
  chartData[tenantIndex + offset][tickCount] = currentCount + count;
  console.log(chartData);
  chart.setData(chartData);
}

function stripeJobs() {
  const map = new Map();
  for (const job of jobs) {
    let group = map.get(job.color);
    if (group) {
      group.push(job);
    } else {
      map.set(job.color, [job]);
    }
  }

  const groups = [...map.values()];
  jobs = [];
  for (let i = 0; i < 1000; i++) {
    let anyJobsLeft = false;
    for (const group of groups) {
      const job = group[i];
      if (job) {
        anyJobsLeft = true;
        jobs.push(job);
      }
    }
    if (!anyJobsLeft) {
      break;
    }
  }
}

// Fisher-Yates, if I did it right?
function shuffleJobs() {
  for (let i = 0; i < jobs.length - 1; i++) {
    const j = i + Math.floor(Math.random() * (jobs.length - i));
    const temp = jobs[i];
    jobs[i] = jobs[j];
    jobs[j] = temp;
  }
}

function clearAll() {
  workersRunning = false;
  jobs = [];
  delayedJobs = [];
  workers.forEach((worker) => {
    worker.blocked = false;
    worker.ticks = 0;
    delete worker.job;
  });
}

function tick() {
  tickCount += 1;

  for (const delayedJob of delayedJobs) {
    delayedJob.ticks -= 1;
    if (delayedJob.ticks <= 0) {
      jobs.push(delayedJob.job);
    }
  }
  delayedJobs = delayedJobs.filter(dj => dj.ticks > 0);

  for (const worker of workers) {
    if (!worker.job) {
      if (jobs.length === 0) {
        continue;
      }

      worker.blocked = false;
      worker.ticks = 0;
      worker.job = jobs.shift();
    }

    const blockedBefore = worker.blocked;
    const otherCount = workers.filter(w => w !== worker && !w.blocked && w.job?.color === worker.job.color).length;
    worker.blocked = otherCount >= semaphoreSize;
    if (worker.blocked && blockedBefore && requeueWhenBlocked) {
      worker.blocked = false;
      worker.ticks = 0;
      if (requeueWithDelay) {
        delayedJobs.push({ ticks: randomDelay ? (Math.random() > 0.5 ? 40 : 80) : 10, job: worker.job });
      } else {
        jobs.push(worker.job);
      }
      delete worker.job;
    } else if (!worker.blocked) {
      // Finish on same tick.
      worker.ticks += 1;

      if (worker.ticks >= worker.job.effort) {
        worker.ticks = 0;
        delete worker.job;
      }
    }
  }

  const counts = new Map(tenants.map(tenant => [tenant.color, 0]));
  const increment = (color) => counts.set(color, counts.get(color) + 1);
  for (const delayedJob of delayedJobs) {
    increment(delayedJob.job.color);
  }
  for (const job of jobs) {
    increment(job.color);
  }
  for (const worker of workers) {
    if (worker.job) {
      increment(worker.job.color);
    }
  }

  chartData[0].push(tickCount);
  chartData[1].push(workers.length);
  chartData[2].push(workers.filter(w => !w.blocked && w.job).length);
  const offset = 3;
  for (let i = 0; i < tenants.length; i++) {
    const tenant = tenants[i];
    const data = chartData[i + offset];
    data.push(counts.get(tenant.color));
  }
  chart.setData(chartData);
}

function isEmpty() {
  return delayedJobs.length === 0 && jobs.length === 0 && workers.filter(w => w.job).length === 0;
}

let intervalId;
function startSim() {
  intervalId = setInterval(() => {
    tick();
    m.redraw();
    if (stopWhenEmpty && isEmpty()) {
      pauseSim();
    }
  }, tickSize);
}

function pauseSim() {
  clearInterval(intervalId);
  intervalId = undefined;
}

function setStopWhenEmpty(event) {
  stopWhenEmpty = event.target.checked;
}

function setRequeueWhenBlocked(event) {
  requeueWhenBlocked = event.target.checked;
}

function setRequeueWithDelay(event) {
  requeueWithDelay = event.target.checked;
}

function setRandomDelay(event) {
  randomDelay = event.target.checked;
}

function prepareChart(elem) {
  chart = new uPlot({
    title: 'Jobs',
    height: 400,
    width: 800,
    series: [
      {},
      {label: 'Workers', dash: [10, 5], stroke: 'gray', fill: 'rgba(100, 100, 100, 0.3)', },
      {label: 'Working', dash: [5, 2], stroke: 'green', fill: 'rgba(0, 255, 0, 0.3)'},
      ...tenants.map(tenant => ({
        label: tenant.color,
        stroke: tenant.color,
        width: 1,
      })),
    ],
    axes: [
      {
        side: 2,
        label: 'Tick',
      },
      {
        side: 3,
        label: 'Jobs',
      },
    ],
    scales: {
      y: {
        range: [0, null],
      },
      x: {
        time: false,
      }
    },
  }, chartData, elem);
}

m.mount(root, {
  view() {
    return m('div',
      m('div', tickCount),
      m('div',
        m('input', { type: 'range', min: 10, max: 500, value: tickSize, disabled: intervalId, oninput: (event) => {
          tickSize = parseInt(event.target.value);
        }}),
      ),
      m('button', { type: 'button', onclick: addTenant }, 'Add Tenant'),
      m('button', { type: 'button', onclick: addWorker }, 'Add Worker'),
      !intervalId
        ? m('button', { type: 'button', onclick: startSim }, 'Start Sim')
        : m('button', { type: 'button', onclick: pauseSim }, 'Pause Sim'),

      m('input', { id: 'stop-when-empty', type: 'checkbox', onchange: setStopWhenEmpty, checked: stopWhenEmpty }),
      m('label', { for: 'stop-when-empty' }, 'Stop When Empty'),

      m('input', { id: 'requeue-when-blocked', type: 'checkbox', onchange: setRequeueWhenBlocked }),
      m('label', { for: 'requeue-when-blocked' }, 'Requeue When Blocked'),

      m('input', { id: 'requeue-with-delay', type: 'checkbox', onchange: setRequeueWithDelay }),
      m('label', { for: 'requeue-with-delay' }, 'Requeue With Delay'),

      m('input', { id: 'random-delay', type: 'checkbox', onchange: setRandomDelay }),
      m('label', { for: 'random-delay' }, 'Random Delay'),

      m('button', { type: 'button', onclick: stripeJobs }, 'Stripe Jobs'),
      m('button', { type: 'button', onclick: shuffleJobs }, 'Shuffle Jobs'),
      m('button', { type: 'button', onclick: clearAll }, 'Clear All'),
      m('button', { type: 'button', onclick: save }, 'Save'),
      m('button', { type: 'button', onclick: load }, 'Load'),
      m('div', { style: 'margin-top: 1rem; display: flex; height: 64px;' }, tenants.map(tenant => m(TenantComponent, { tenant }))),
      m(DelayQueuesComponent, { delayedJobs }),
      m(QueueComponent, { jobs }),
      m('div', { style: 'margin-top: 1rem; display: flex;' }, workers.map(worker => m(WorkerComponent, { worker }))),
      m('#chart', { oncreate: (vnode) => prepareChart(vnode.dom) }),
    );
  }
});
