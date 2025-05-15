export function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

export function getMinimumSpanningTree(items, distFunc, opt = {}) {
  const { maxSteps = Infinity } = opt;
  if (items.length <= 1) return [];
  distFunc = distFunc || euclideanDistance;

  let connected = new Set([items[0]]);
  let remaining = new Set(items.slice(1));
  let connections = new Set();
  let results = [];
  let steps = 0;

  while (remaining.size > 0 && steps < maxSteps) {
    steps++;
    const result = findWithMinDistance(connected, remaining, distFunc);

    if (!result || !isFinite(result.distance)) {
      console.warn("Stopping early: no more finite edges found.");
      break;
    }

    const { from, to, distance } = result;
    const i = items.indexOf(from),
      j = items.indexOf(to),
      key = [Math.min(i, j), Math.max(i, j)].join(":");

    if (!connections.has(key)) {
      connections.add(key);
      results.push({ from, to, distance, indices: [i, j], key });
      connected.add(to);
      remaining.delete(to);
    }
  }

  return results;
}

// export function getMinimumSpanningTree(items, distFunc, opt = {}) {
//   const { maxSteps = Infinity } = opt;
//   if (items.length <= 1) return [];
//   distFunc = distFunc || euclideanDistance;
//   let indices = new Map();
//   items.forEach((c, i) => {
//     indices.set(c, i);
//   });
//   let connected = new Set(items.slice(0, 1));
//   let remaining = new Set(items.slice(1));
//   let connections = new Map();
//   let steps = 0;
//   let results = [];
//   while (remaining.size != 0 && steps++ < maxSteps) {
//     if (steps > maxSteps - 1) console.warn("Infinite loop");
//     const result = findWithMinDistance(connected, remaining, distFunc);
//     if (!result || !isFinite(result.distance)) continue;

//     const { from, to, distance } = result;

//     let keys = [indices.get(from), indices.get(to)];
//     const indexList = keys.slice();
//     keys.sort();
//     const key = keys.join(":");
//     if (!connections.has(key)) {
//       connections.set(key, true);
//       results.push({ ...result, indices: indexList, key });
//       connected.add(to);
//       remaining.delete(to);
//     }
//   }
//   return results;
// }

function findWithMinDistance(connected, remaining, distanceFn) {
  let minDist = Infinity;
  let from, candidate;
  for (let a of connected) {
    for (let b of remaining) {
      let dist = distanceFn(a, b);
      if (dist < minDist) {
        minDist = dist;
        from = a;
        candidate = b;
      }
    }
  }
  return { from, to: candidate, distance: minDist };
}

function findWithMaxDistance(connected, remaining, distanceFn) {
  let maxDistance = -Infinity;
  let from, candidate;
  for (let a of connected) {
    for (let b of remaining) {
      let dist = distanceFn(a, b);
      if (dist > maxDistance) {
        maxDistance = dist;
        from = a;
        candidate = b;
      }
    }
  }
  return { from, to: candidate, distance: maxDistance };
}
