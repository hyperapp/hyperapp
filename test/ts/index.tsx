import { h, app, ActionsType, View, Component, VNode } from 'hyperapp';

namespace Counter {
  export interface State {
    count: number;
  }

  export interface Actions {
    down(): State;
    up(value: number): State;
  }

  export const state: State = {
    count: 0,
  };

  export const actions: ActionsType<State, Actions> = {
    down: () => (state) => ({ count: state.count - 1 }),
    up: (value: number) => (state) => ({
      count: state.count + value,
    }),
  };
}

const view: View<Counter.State, Counter.Actions> = (state, actions) => (
  <main>
    <div>{state.count}</div>
    <button onclick={actions.down}>-</button>
    <button onclick={actions.up}>+</button>
  </main>
);

const comp: Component<{}, Counter.State, Counter.Actions> = (
  attributes: {},
  children: Array<VNode | string>
) => {
  return h('div', {}, 'component');
};

const view2: View<Counter.State, Counter.Actions> = (state, actions) =>
  h('div', {}, [comp({}, [])]);

app<Counter.State, Counter.Actions>(
  Counter.state,
  Counter.actions,
  view,
  document.body
);
