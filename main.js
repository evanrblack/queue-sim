// TODO: Add and configure failure rate, delay timing, job spawning, dynamic workers
let tenants = new Map();
let jobs = [];
let delayedJobs = [];
let workers = [];
let semaphoreSize = 1;
let tickSize = 50;
let tickCount = 0;
let tenantIdSeq = 0;
let jobIdSeq = 0;
let running = false;
let stopWhenEmpty = true;
let requeueWhenBlocked = false;
let requeueDelay = 0;
let requeueDelayRandomFactor = 0;

let chartData = [[0], [0], [0], [0]];
let chartElem;
let chart;

const root = document.getElementById('root');

const TenantComponent = {
  view(vnode) {
    const { tenant } = vnode.attrs;
    return m(
      'form.me-3.mb-3',
      { 'data-tenant-form': true, onsubmit: addJobsFromTenant },
      m(
        '.input-group',
        m(
          'span.input-group-text',
          { style: `border: 4px solid ${tenant.color}` },
          `T${tenant.id}`,
        ),
        m('input', { name: 'tenant-id', type: 'hidden', value: tenant.id }),
        m('span.input-group-text', 'Count:'),
        m('input.form-control', {
          name: 'count',
          type: 'number',
          min: 1,
          max: 100,
          step: 1,
          style: 'width: 100px',
        }),
        m('span.input-group-text', 'Priority:'),
        m('input.form-control', {
          name: 'priority',
          type: 'number',
          min: 0,
          max: 255,
          step: 1,
          style: 'width: 100px',
        }),
        m('button.btn.btn-outline-secondary', { type: 'submit' }, '+'),
      ),
    );
  },
};

const JobComponent = {
  view(vnode) {
    const { job } = vnode.attrs;
    const color = tenants.get(job.tenantId)?.color ?? '#999999';
    const size = vnode.attrs.size ?? 64;
    return m(
      'div',
      {
        style: `width: ${size}px; height: ${size}px; background-color: ${color}; border: 1px solid black; overflow: hidden; position: relative;`,
      },
      m(
        'div',
        {
          style:
            'display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: white; background-color: black; position: absolute; top: 0; right: 0; font-size: 12px;',
        },
        job.effort,
      ),
      m(
        'div',
        {
          style:
            'display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: black; background-color: white; position: absolute; top: 16px; right: 0; font-size: 12px;',
        },
        job.priority,
      ),
    );
  },
};

const QueueComponent = {
  view(vnode) {
    const { jobs } = vnode.attrs;
    const delayCount = delayedJobs.length;
    const delayAverage = Math.round(
      delayedJobs.reduce((acc, cur) => acc + cur.ticks, 0) / delayedJobs.length,
    );
    return m(
      '.card.mt-3',
      m(
        '.card-header.d-flex',
        m('.flex-grow-1', 'Jobs'),
        m(
          'button.btn.btn-outline-light.btn-sm',
          { type: 'button', onclick: sortJobsByTenant },
          'Sort Jobs',
        ),
        m(
          'button.btn.btn-outline-light.btn-sm.ms-1',
          { type: 'button', onclick: stripeJobs },
          'Stripe Jobs',
        ),
        m(
          'button.btn.btn-outline-light.btn-sm.ms-1',
          { type: 'button', onclick: shuffleJobs },
          'Shuffle Jobs',
        ),
        m(
          'button.btn.btn-outline-light.btn-sm.ms-1',
          { type: 'button', onclick: clearAll },
          'Clear All',
        ),
      ),
      m(
        '.card-body',
        jobs.length === 0 &&
          m('.text-center', { style: 'height: 64px' }, 'No jobs in the queue.'),
        m(
          '.d-flex',
          jobs.map((job) => m(JobComponent, { job, key: job.id })),
        ),
      ),
      m(
        '.card-footer',
        m(
          '.row',
          m('.col-2', `Delayed jobs: ${delayCount}`),
          m(
            '.col-2',
            `Cur. avg. delay: ${Number.isNaN(delayAverage) ? '--' : delayAverage}`,
          ),
        ),
      ),
    );
  },
};

const WorkerComponent = {
  view(vnode) {
    const { worker } = vnode.attrs;
    const { job, blocked } = worker;
    return m(
      '.card.m-1',
      {
        style: `width: 96px; height: 96px; display: flex; justify-content: center; align-items: center; border: 1px solid gray; background-color: ${blocked ? '#ffcccc' : job ? '#ccffcc' : ''}`,
      },
      job &&
        m(
          'div',
          m('progress', {
            value: worker.ticks,
            max: job.effort,
            style: `width: 64px; height: 8px;`,
          }),
          m(JobComponent, { job }),
        ),
    );
  },
};

function sample(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function addTenant(color) {
  const id = (tenantIdSeq++).toString();
  color = '#' + ((Math.random() * 0xffffff) << 0).toString(16).padEnd(6, '0');
  tenants.set(id, { id, color });

  chart.addSeries({
    label: id,
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

function newJob(tenantId, priority = 1) {
  return {
    id: jobIdSeq++,
    tenantId,
    effort: 20 + Math.ceil(Math.random() * 20),
    priority,
  };
}

function save() {
  localStorage.saved = JSON.stringify({
    tickCount,
    tenants: [...tenants.values()],
    delayedJobs,
    jobs,
    workers,
    chartData,
  });
}

function load() {
  const data = JSON.parse(localStorage.saved ?? '{}');
  tickCount = data.tickCount ?? 0;
  tenants = new Map((data.tenants ?? []).map((t) => [t.id, t]));
  delayedJobs = data.delayedJobs ?? [];
  jobs = data.jobs ?? [];
  workers = data.workers ?? [];
  chartData = data.chartData ?? [[0], [0], [0], [0]];

  chart.destroy();
  prepareChart(document.getElementById('chart'));
}

function sortJobsByTenant() {
  jobs = jobs.sort((a, b) => a.tenantId - b.tenantId);
  sortJobsByPriority();
}

function addJobsFromTenant(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const count = parseInt(data.get('count') || '0');
  const priority = parseInt(data.get('priority') || '0');
  const tenantId = data.get('tenant-id');
  for (let i = 0; i < count; i++) {
    jobs.push(newJob(tenantId, priority));
  }

  sortJobsByPriority();

  const offset = 4;
  const tenantIndex = [...tenants.values()].findIndex((t) => t.id == tenantId);
  const currentCount = chartData[tenantIndex + offset][tickCount] ?? 0;
  chartData[tenantIndex + offset][tickCount] = currentCount + count;
  chart.setData(chartData);
}

function stripeJobs() {
  const map = new Map();
  for (const job of jobs) {
    let group = map.get(job.tenantId);
    if (group) {
      group.push(job);
    } else {
      map.set(job.tenantId, [job]);
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

  sortJobsByPriority();
}

// Fisher-Yates, if I did it right?
function shuffleJobs() {
  for (let i = 0; i < jobs.length - 1; i++) {
    const j = i + Math.floor(Math.random() * (jobs.length - i));
    const temp = jobs[i];
    jobs[i] = jobs[j];
    jobs[j] = temp;
  }

  sortJobsByPriority();
}

function clearAll() {
  workersRunning = false;
  delayedJobs = [];
  jobs = [];
  workers.forEach((worker) => {
    worker.blocked = false;
    worker.ticks = 0;
    delete worker.job;
  });
  chartData.forEach((d) => (d[tickCount] = 0));
  chart.setData(chartData);
}

// For priority.
function sortJobsByPriority() {
  const groups = [];
  for (const elem of jobs) {
    const priority = elem.priority ?? 0;
    if (groups[priority]) {
      groups[priority].push(elem);
    } else {
      groups[priority] = [elem];
    }
  }

  const sorted = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (!group) {
      continue;
    }
    for (const item of group) {
      sorted.push(item);
    }
  }

  jobs = sorted;
}

function tick() {
  tickCount += 1;

  for (const delayedJob of delayedJobs) {
    delayedJob.ticks -= 1;
    if (delayedJob.ticks <= 0) {
      jobs.push(delayedJob.job);
    }
  }
  delayedJobs = delayedJobs.filter((dj) => dj.ticks > 0);

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
    const otherCount = workers.filter(
      (w) =>
        w !== worker && !w.blocked && w.job?.tenantId === worker.job.tenantId,
    ).length;
    worker.blocked = otherCount >= semaphoreSize;
    if (worker.blocked && blockedBefore && requeueWhenBlocked) {
      worker.blocked = false;
      worker.ticks = 0;
      if (requeueDelay) {
        delayedJobs.push({
          ticks: Math.round(
            requeueDelay +
              requeueDelay * (1 - Math.random() * 2) * requeueDelayRandomFactor,
          ),
          job: worker.job,
        });
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

  sortJobsByPriority();

  const tenantsArray = [...tenants.values()];
  const counts = new Map(tenantsArray.map((tenant) => [tenant.id, 0]));
  const increment = (tenantId) =>
    counts.set(tenantId, counts.get(tenantId) + 1);
  for (const delayedJob of delayedJobs) {
    increment(delayedJob.job.tenantId);
  }
  for (const job of jobs) {
    increment(job.tenantId);
  }
  for (const worker of workers) {
    if (worker.job) {
      increment(worker.job.tenantId);
    }
  }

  chartData[0].push(tickCount);
  chartData[1].push(workers.length);
  chartData[2].push(workers.filter((w) => !w.blocked && w.job).length);
  chartData[3].push(delayedJobs.length);
  let index = 0;
  const offset = 4;
  for (const [id, _] of tenants) {
    const data = chartData[index++ + offset];
    data.push(counts.get(id));
  }
  chart.setData(chartData);
}

function isEmpty() {
  return (
    delayedJobs.length === 0 &&
    jobs.length === 0 &&
    workers.filter((w) => w.job).length === 0
  );
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

function setRequeueDelay(event) {
  requeueDelay = parseInt(event.target.value);
}

function setRequeueDelayRandomFactor(event) {
  requeueDelayRandomFactor = event.target.value;
}

function prepareChart(elem) {
  chart = new uPlot(
    {
      height: 300,
      width: elem.getBoundingClientRect().width,
      series: [
        {},
        {
          label: 'Workers',
          dash: [10, 5],
          stroke: 'gray',
          fill: 'rgba(100, 100, 100, 0.3)',
        },
        {
          label: 'Working',
          dash: [5, 2],
          stroke: 'green',
          fill: 'rgba(0, 255, 0, 0.3)',
        },
        {
          label: 'Delayed',
          dash: [7, 3],
          stroke: 'white',
        },
        ...[...tenants.values()].map((tenant) => ({
          label: tenant.id,
          stroke: tenant.color,
          width: 1,
        })),
      ],
      axes: [
        {
          side: 2,
          // label: 'Tick',
          stroke: 'white',
          grid: {
            stroke: '#333',
          },
        },
        {
          side: 3,
          // label: 'Jobs',
          stroke: 'white',
          grid: {
            stroke: '#333',
          },
        },
      ],
      scales: {
        y: {
          range: [0, null],
        },
        x: {
          time: false,
        },
      },
    },
    chartData,
    elem,
  );
}

m.mount(root, {
  view() {
    return m.fragment(
      {},
      m(
        '.card',
        m(
          '.card-header.d-flex',
          m('.flex-grow-1', 'Tenants'),
          m(
            'button.btn.btn-outline-light.btn-sm',
            { type: 'button', onclick: addTenant },
            'Add Tenant',
          ),
        ),
        m(
          '.card-body',
          tenants.size === 0 && m('.text-center', 'No tenants added.'),
          m(
            '.d-flex.flex-wrap',
            [...tenants.values()].map((tenant) =>
              m(TenantComponent, { tenant }),
            ),
          ),
        ),
      ),
      m(QueueComponent, { jobs }),
      m(
        '.card.mt-3',
        m(
          '.card-header.d-flex',
          m('.flex-grow-1', 'Workers'),
          m(
            'button.btn.btn-outline-light.btn-sm',
            { type: 'button', onclick: addWorker },
            'Add Worker',
          ),
        ),
        m(
          '.card-body',
          workers.length === 0 && m('.text-center', 'No workers added.'),
          m(
            '.d-flex.flex-wrap',
            workers.map((worker) => m(WorkerComponent, { worker })),
          ),
        ),
      ),
      m(
        '.card.mt-3',
        m(
          '.card-header.d-flex',
          m('.flex-grow-1', 'Simulation'),
          m(
            'div',
            m(
              'button.btn.btn-outline-light.btn-sm',
              { type: 'button', onclick: save },
              'Save',
            ),
            m(
              'button.btn.btn-outline-light.btn-sm.ms-1',
              { type: 'button', onclick: load },
              'Load',
            ),
            !intervalId
              ? m(
                  'button.btn.btn-primary.btn-sm.ms-1',
                  { type: 'button', onclick: startSim },
                  'Start Sim',
                )
              : m(
                  'button.btn.btn-primary.btn-sm.ms-1',
                  { type: 'button', onclick: pauseSim },
                  'Pause Sim',
                ),
          ),
        ),
        m(
          '.card-body',
          m('#chart', { oncreate: (vnode) => prepareChart(vnode.dom) }),
          m(
            '.row.mt-3',
            m(
              '.col.col-3',
              m(
                '.card',
                m(
                  '.card-body',
                  m(
                    '.form-check.form-check-inline.form-switch',
                    m('input.form-check-input', {
                      id: 'stop-when-empty',
                      type: 'checkbox',
                      role: 'switch',
                      onchange: setStopWhenEmpty,
                      checked: stopWhenEmpty,
                    }),
                    m(
                      'label.form-check-label',
                      { for: 'stop-when-empty' },
                      'Stop when empty',
                    ),
                  ),
                  m('hr'),
                  m(
                    '.form-group',
                    m(
                      'label.form-label',
                      { for: 'tick-size' },
                      `Tick size: ${tickSize}`,
                    ),
                    m('input.form-range', {
                      id: 'tick-size',
                      type: 'range',
                      min: 10,
                      max: 500,
                      value: tickSize,
                      disabled: intervalId,
                      oninput: (event) => {
                        tickSize = parseInt(event.target.value);
                      },
                    }),
                  ),
                ),
              ),
            ),
            m(
              '.col.col-3',
              m(
                '.card',
                m(
                  '.card-body',
                  m(
                    '.form-check.form-check-inline.form-switch',
                    m('input.form-check-input', {
                      id: 'requeue-when-blocked',
                      type: 'checkbox',
                      role: 'switch',
                      onchange: setRequeueWhenBlocked,
                      checked: requeueWhenBlocked,
                    }),
                    m(
                      'label.form-check-label',
                      { for: 'requeue-when-blocked' },
                      'Requeue when blocked',
                    ),
                  ),
                  m('hr'),

                  m(
                    '.form-group',
                    m(
                      'label.form-label',
                      { for: 'requeue-delay' },
                      `Requeue delay: ${requeueDelay}`,
                    ),
                    m('input.form-range', {
                      id: 'requeue-delay',
                      type: 'range',
                      min: 0,
                      max: 100,
                      value: requeueDelay,
                      oninput: setRequeueDelay,
                    }),
                  ),

                  m(
                    '.form-group',
                    m(
                      'label.form-label',
                      { for: 'requeue-delay-random-factor' },
                      `Requeue delay random factor: ${requeueDelayRandomFactor}`,
                    ),
                    m('input.form-range', {
                      id: 'requeue-delay-random-factor',
                      type: 'range',
                      min: 0,
                      max: 0.9,
                      step: 0.1,
                      value: requeueDelayRandomFactor,
                      oninput: setRequeueDelayRandomFactor,
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  },
});
