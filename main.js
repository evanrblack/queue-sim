const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🫠',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺', '😚', '😙',
  '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🫢', '🫣',
  '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😶‍🌫️', '😏',
  '😒', '🙄', '😬', '😮‍💨', '🤥', '🫨', '😌', '😔', '😪', '🤤', '😴',
  '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '😵‍💫',
  '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁',
  '☹', '😮', '😯', '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰',
  '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱',
  '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠', '💩', '🤡', '👹',
  '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽',
  '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💌', '💘', '💝', '💖', '💗',
  '💓', '💞', '💕', '💟', '❣', '💔', '❤️‍🔥', '❤️‍🩹', '❤', '🩷', '🧡',
  '💛', '💚', '💙', '🩵', '💜', '🤎', '🖤', '🩶', '🤍', '💋', '💯',
  '💢', '💥', '💫', '💦', '💨', '🕳', '💬', '👁️‍🗨️', '🗨', '🗯', '💭', '💤',
  '👋', '🤚', '🖐', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '🫷', '🫸',
  '👌', '🤌', '🤏', '✌', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉',
  '👆', '🖕', '👇', '☝', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜',
  '👏'
];

let tenants = [];
let jobs = [];
let delayedJobs = [];
let workers = [];
let semaphoreSize = 1;
let tickSize = 300;
let tickCount = 0;
let id = 1;
let running = false;

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
    return m('div', { style: `width: 64px; height: 64px; display: flex; justify-content: center; align-items: center; background-color: ${job.color}; border: 1px solid black; overflow: hidden; position: relative;` },
      m('div', { style: 'display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: white; background-color: black; position: absolute; top: 0; right: 0; font-size: 12px;' }, job.effort),
      m('div', { style: 'font-size: 32px' }, job.emoji),
    );
  }
};

const WorkerComponent = {
  view(vnode) {
    const { worker } = vnode.attrs;
    const { job, blocked } = worker;
    return m('div', { style: 'width: 96px; height: 96px; display: flex; justify-content: center; align-items: center; border: 1px solid black;' },
      job && m('div',
        m('progress', { value: worker.ticks, max: job.effort, style: `width: 64px; height: 8px; background-color: ${blocked ? 'red' : 'auto'}` }),
        m(JobComponent, { job })
      ),
    );
  }
};

function sample(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function addTenant() {
  const color = '#'+(Math.random()*0xFFFFFF<<0).toString(16);
  tenants.push({ color });
}

function addWorker() {
  workers.push({ ticks: 0 });
}

function newJob(color) {
  return { id: id++, emoji: sample(EMOJIS), color, effort: Math.ceil(Math.random() * 10) };
}

function addJobsFromTenant(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const count = parseInt(data.get('count') || '0');
  const color = data.get('color');
  for (let i = 0; i < count; i++) {
    jobs.push(newJob(color));
  }
}

function stripeJobs() {
  const jobsByTenant = [];
  for (const form of document.querySelectorAll('[data-tenant-form]')) {
    const data = new FormData(form);
    const count = parseInt(data.get('count') || '0');
    const color = data.get('color');
    const newJobs = [];
    for (let i = 0; i < count; i++) {
      newJobs.push(newJob(color));
    }
    jobsByTenant.push(newJobs);
  }

  let jobsInBatch = [];
  for (let i = 0; i < 100; i++) {
    for (const tenantJobs of jobsByTenant) {
      const job = tenantJobs[i];
      console.log(job);
      if (job) {
        jobsInBatch.push(job);
      }
    }
    if (jobsInBatch.length === 0) {
      break;
    }
    jobs.push(...jobsInBatch);
    jobsInBatch = [];
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
  for (const worker of workers) {
    if (worker.job && worker.blocked) {
      jobs.push(worker.job);
      delete worker.job;
      worker.blocked = false;
    } else if (worker.job && worker.ticks >= worker.job.effort) {
      delete worker.job;
      worker.ticks = 0;
    } else if (worker.job) {
      worker.ticks += 1;
    } else if (jobs.length) {
      worker.job = jobs.shift();
      const count = workers.filter(w => !w.blocked && w.job?.color === worker.job.color).length;
      worker.blocked = count > semaphoreSize;
    }
  }
}

let intervalId;
function startSim() {
  intervalId = setInterval(() => {
    tick();
    m.redraw();
  }, tickSize);
}

function pauseSim() {
  clearInterval(intervalId);
  intervalId = undefined;
}

m.mount(root, {
  view() {
    return m('div',
      m('div', tickCount),
      m('button', { type: 'button', onclick: addTenant }, 'Add Tenant'),
      m('button', { type: 'button', onclick: addWorker }, 'Add Worker'),
      !intervalId
        ? m('button', { type: 'button', onclick: startSim }, 'Start Sim')
        : m('button', { type: 'button', onclick: pauseSim }, 'Pause Sim'),
      m('button', { type: 'button', onclick: clearAll }, 'Clear All'),
      m('button', { type: 'button', onclick: stripeJobs }, 'Stripe Jobs'),
      m('div', { style: 'margin-top: 1rem; display: flex; height: 64px;' }, tenants.map(tenant => m(TenantComponent, { tenant }))),
      m('div', { style: 'margin-top: 1rem; display: flex; height: 96px;' }, jobs.map(job => m(JobComponent, { job, key: job.id }))),
      m('div', { style: 'margin-top: 1rem; display: flex;' }, workers.map(worker => m(WorkerComponent, { worker }))),
    );
  }
});
