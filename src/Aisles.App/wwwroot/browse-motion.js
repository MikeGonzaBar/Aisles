export function browseMotion(from, to) {
  const rest = { transform: 'translate3d(0, 0, 0)' };

  if (from === 'shelf') {
    return {
      duration: 320,
      incoming: [{ transform: 'translate3d(0, 100%, 0)' }, rest],
    };
  }

  if (to === 'shelf') {
    return {
      duration: 320,
      outgoing: [rest, { transform: 'translate3d(0, 100%, 0)' }],
    };
  }

  const direction = from === 'covers' && to === 'list' ? -100 : 100;
  return {
    duration: 260,
    outgoing: [rest, { transform: `translate3d(${direction}%, 0, 0)` }],
    incoming: [{ transform: `translate3d(${-direction}%, 0, 0)` }, rest],
  };
}
