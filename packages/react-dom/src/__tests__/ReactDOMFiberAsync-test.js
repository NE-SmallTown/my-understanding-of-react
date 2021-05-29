/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;

let ReactDOM;
let Scheduler;
let act;

const setUntrackedInputValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
).set;

describe('ReactDOMFiberAsync', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    container = document.createElement('div');
    React = require('react');
    ReactDOM = require('react-dom');
    act = require('react-dom/test-utils').unstable_concurrentAct;
    Scheduler = require('scheduler');

    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders synchronously by default', () => {
    const ops = [];
    ReactDOM.render(<div>Hi</div>, container, () => {
      ops.push(container.textContent);
    });
    ReactDOM.render(<div>Bye</div>, container, () => {
      ops.push(container.textContent);
    });
    expect(ops).toEqual(['Hi', 'Bye']);
  });

  it('flushSync batches sync updates and flushes them at the end of the batch', () => {
    const ops = [];
    let instance;

    class Component extends React.Component {
      state = {text: ''};
      push(val) {
        this.setState(state => ({text: state.text + val}));
      }
      componentDidUpdate() {
        ops.push(this.state.text);
      }
      render() {
        instance = this;
        return <span>{this.state.text}</span>;
      }
    }

    ReactDOM.render(<Component />, container);

    instance.push('A');
    expect(ops).toEqual(['A']);
    expect(container.textContent).toEqual('A');

    ReactDOM.flushSync(() => {
      instance.push('B');
      instance.push('C');
      // Not flushed yet
      expect(container.textContent).toEqual('A');
      expect(ops).toEqual(['A']);
    });
    expect(container.textContent).toEqual('ABC');
    expect(ops).toEqual(['A', 'ABC']);
    instance.push('D');
    expect(container.textContent).toEqual('ABCD');
    expect(ops).toEqual(['A', 'ABC', 'ABCD']);
  });

  it('flushSync flushes updates even if nested inside another flushSync', () => {
    const ops = [];
    let instance;

    class Component extends React.Component {
      state = {text: ''};
      push(val) {
        this.setState(state => ({text: state.text + val}));
      }
      componentDidUpdate() {
        ops.push(this.state.text);
      }
      render() {
        instance = this;
        return <span>{this.state.text}</span>;
      }
    }

    ReactDOM.render(<Component />, container);

    instance.push('A');
    expect(ops).toEqual(['A']);
    expect(container.textContent).toEqual('A');

    ReactDOM.flushSync(() => {
      instance.push('B');
      instance.push('C');
      // Not flushed yet
      expect(container.textContent).toEqual('A');
      expect(ops).toEqual(['A']);

      ReactDOM.flushSync(() => {
        instance.push('D');
      });
      // The nested flushSync caused everything to flush.
      expect(container.textContent).toEqual('ABCD');
      expect(ops).toEqual(['A', 'ABCD']);
    });
    expect(container.textContent).toEqual('ABCD');
    expect(ops).toEqual(['A', 'ABCD']);
  });

  it('flushSync logs an error if already performing work', () => {
    class Component extends React.Component {
      componentDidUpdate() {
        ReactDOM.flushSync(() => {});
      }
      render() {
        return null;
      }
    }

    // Initial mount
    ReactDOM.render(<Component />, container);
    // Update
    expect(() => ReactDOM.render(<Component />, container)).toErrorDev(
      'flushSync was called from inside a lifecycle method',
    );
  });

  describe('concurrent mode', () => {
    // 对于离散事件（click，input 这些）都是 user-blocking 优先级（或者是比这还高的 immediate 优先级的其它任务），所以 handleChange 里的 setState
    // 会走 concurrent 那一套
    // 而 handleChange 再通过 requestIdleCallback（其实 setTimeout，rAF 都一样）去 setState
    // 会走同步 batch 更新那一套
    // 而不是像非 concurrent 里 setTimeout 那样是非 batch 的完全同步（setState 完就 commit 了），它们的区别是
    // 后者执行完 scheduleCallbackForRoot 会直接调 flushSyncCallbackQueue（SyncCallbackQueue 是 scheduleCallbackForRoot push 进去的）
    // flushSyncCallbackQueue 会去走 renderRoot 那一套，所以就等价于直接更新了
    // Tip: 当 scheduledHostCallback 为 null 之后，之前的设置的会自动执行的嵌套 rAF（自动执行）也就停止了，因为直接 return 没有再调用 rAF 了，要等下次有任务的时候才调
    it('does not perform deferred updates synchronously', () => {
      const inputRef = React.createRef();
      const asyncValueRef = React.createRef();
      const syncValueRef = React.createRef();

      class Counter extends React.Component {
        state = {asyncValue: '', syncValue: ''};

        handleChange = e => {
          const nextValue = e.target.value;
          requestIdleCallback(() => {
            this.setState({
              asyncValue: nextValue,
            });
            // It should not be flushed yet.
            expect(asyncValueRef.current.textContent).toBe('');
          });
          this.setState({
            syncValue: nextValue,
          });
        };

        render() {
          return (
            <div>
              <input
                ref={inputRef}
                onChange={this.handleChange}
                defaultValue=""
              />
              <p ref={asyncValueRef}>{this.state.asyncValue}</p>
              <p ref={syncValueRef}>{this.state.syncValue}</p>
            </div>
          );
        }
      }
      const root = ReactDOM.createRoot(container);
      root.render(<Counter />);
      Scheduler.unstable_flushAll();
      expect(asyncValueRef.current.textContent).toBe('');
      expect(syncValueRef.current.textContent).toBe('');

      setUntrackedInputValue.call(inputRef.current, 'hello');
      inputRef.current.dispatchEvent(new MouseEvent('input', {bubbles: true}));
      // Should only flush non-deferred update.
      expect(asyncValueRef.current.textContent).toBe('');
      expect(syncValueRef.current.textContent).toBe('hello');

      // Should flush both updates now.
      jest.runAllTimers();
      Scheduler.unstable_flushAll();
      expect(asyncValueRef.current.textContent).toBe('hello');
      expect(syncValueRef.current.textContent).toBe('hello');
    });

    it('top-level updates are concurrent', () => {
      const root = ReactDOM.createRoot(container);
      root.render(<div>Hi</div>);
      expect(container.textContent).toEqual('');
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('Hi');

      root.render(<div>Bye</div>);
      expect(container.textContent).toEqual('Hi');
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('Bye');
    });

    it('deep updates (setState) are concurrent', () => {
      let instance;
      class Component extends React.Component {
        state = {step: 0};
        render() {
          instance = this;
          return <div>{this.state.step}</div>;
        }
      }

      const root = ReactDOM.createRoot(container);
      root.render(<Component />);
      expect(container.textContent).toEqual('');
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('0');

      instance.setState({step: 1});
      expect(container.textContent).toEqual('0');
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('1');
    });

    it('flushSync flushes updates before end of the tick', () => {
      const ops = [];
      let instance;

      class Component extends React.Component {
        state = {text: ''};
        push(val) {
          this.setState(state => ({text: state.text + val}));
        }
        componentDidUpdate() {
          ops.push(this.state.text);
        }
        render() {
          instance = this;
          return <span>{this.state.text}</span>;
        }
      }

      const root = ReactDOM.createRoot(container);
      root.render(<Component />);
      Scheduler.unstable_flushAll();

      // Updates are async by default
      instance.push('A');
      expect(ops).toEqual([]);
      expect(container.textContent).toEqual('');

      ReactDOM.flushSync(() => {
        instance.push('B');
        instance.push('C');
        // Not flushed yet
        expect(container.textContent).toEqual('');
        expect(ops).toEqual([]);
      });
      // Only the active updates have flushed
      expect(container.textContent).toEqual('BC');
      expect(ops).toEqual(['BC']);

      instance.push('D');
      expect(container.textContent).toEqual('BC');
      expect(ops).toEqual(['BC']);

      // Flush the async updates
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('ABCD');
      expect(ops).toEqual(['BC', 'ABCD']);
    });

    // @gate experimental
    // unstable_flushControlled 和 flushSync 的区别就是，嵌套的情况下，里面的到底会不会影响外面？
    // 也就是说，里面的 unstable_flushControlled 执行之后，到底要不要连同外层的一起 flush，还是只 flush 自己这一层？
    it('flushControlled flushes updates before yielding to browser', () => {
      let inst;
      class Counter extends React.Component {
        state = {counter: 0};
        increment = () =>
          this.setState(state => ({counter: state.counter + 1}));
        render() {
          inst = this;
          return this.state.counter;
        }
      }
      const root = ReactDOM.createRoot(container);
      root.render(<Counter />);
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('0');

      // Test that a normal update is async
      inst.increment();
      expect(container.textContent).toEqual('0');
      Scheduler.unstable_flushAll();
      expect(container.textContent).toEqual('1');

      const ops = [];
      ReactDOM.unstable_flushControlled(() => {
        inst.increment();
        ReactDOM.unstable_flushControlled(() => {
          inst.increment();
          ops.push('end of inner flush: ' + container.textContent);
        });
        ops.push('end of outer flush: ' + container.textContent);
      });
      ops.push('after outer flush: ' + container.textContent);
      expect(ops).toEqual([
        'end of inner flush: 1',
        'end of outer flush: 1',
        'after outer flush: 3',
      ]);
    });

    // @gate experimental
    it('flushControlled does not flush until end of outermost batchedUpdates', () => {
      let inst;
      class Counter extends React.Component {
        state = {counter: 0};
        increment = () =>
          this.setState(state => ({counter: state.counter + 1}));
        render() {
          inst = this;
          return this.state.counter;
        }
      }
      ReactDOM.render(<Counter />, container);

      const ops = [];
      ReactDOM.unstable_batchedUpdates(() => {
        inst.increment();
        ReactDOM.unstable_flushControlled(() => {
          inst.increment();
          ops.push('end of flushControlled fn: ' + container.textContent);
        });
        ops.push('end of batchedUpdates fn: ' + container.textContent);
      });
      ops.push('after batchedUpdates: ' + container.textContent);
      expect(ops).toEqual([
        'end of flushControlled fn: 0',
        'end of batchedUpdates fn: 0',
        'after batchedUpdates: 2',
      ]);
    });

    // @gate experimental
    it('flushControlled returns nothing', () => {
      // In the future, we may want to return a thenable "work" object.
      let inst;
      class Counter extends React.Component {
        state = {counter: 0};
        increment = () =>
          this.setState(state => ({counter: state.counter + 1}));
        render() {
          inst = this;
          return this.state.counter;
        }
      }
      ReactDOM.render(<Counter />, container);
      expect(container.textContent).toEqual('0');

      const returnValue = ReactDOM.unstable_flushControlled(() => {
        inst.increment();
        return 'something';
      });
      expect(container.textContent).toEqual('1');
      expect(returnValue).toBe(undefined);
    });

    // 触发事件时（手动点击等等或者 dispatchEvent），会先走一大堆逻辑，最后才走真正的源码里的 dispatchEvent

    // 第一次 dispatch 时，rootsWithPendingDiscreteUpdates 为 null，所以不会调 scheduleSyncCallback & flushSyncCallbackQueue
    // 最后 setState 后，taskQueue 里有 renderRoot（scheduleCallbackForRoot 里 push 进去的），同时调了 rAF
    // 第二次 dispatch 时，rootsWithPendingDiscreteUpdates 不为 null，所以会调 scheduleSyncCallback & flushSyncCallbackQueue
    // 在 scheduleSyncCallback 中往 syncQueue 中 push 了 renderRoot，之后又调了 scheduleCallback，所以 taskQueue 里又增加了 flushSyncCallbackQueueImpl
    // 所以目前，syncQueue 为 [renderRoot]，taskQueue 为 [renderRoot, flushSyncCallbackQueueImpl]

    // 第二次 dispatch 后，先执行 flushSyncCallbackQueueImpl 后，走 workLoopSync
    // 发现 updateQueue 里已经有且只有**一个** update （即第一次 dispatch 最后走到了自己代码的 setState，然后 enqueueState）
    // 这时候还没有调 submitForm（因为前面说了，会先走一大堆逻辑）。于是处理完 updateQueue 之后的 state 为 {active: false}（disableForm 的作用）
    // 然后去调组件的 render，这时返回的 children 就没有第二个 button 了，接着就正常走，begin & complete & commit
    // 最后 DOM 上把 button 就干掉了，在这**之后**，才会接着走源码里的 dispatchEvent
    // 但是这个时候事件代理已经找不到 target fiber 的 listener 了（即 props 里的 onClick，因为 submitForm button 的对应 fiber）
    // 即没有 _dispatchListeners 了，所以也就不会去触发这个 listener 了（这里即 submitForm）

    // 以上只是执行了 syncQueue，但是 taskQueue 还没动，执行完 syncQueue 之后过一会，rAF 被触发了，进而会去 flushWork，进而走 workLoop 执行 taskQueue
    // 进而 renderRoot，但是会直接 bailout，为什么呢？
    // 因为一个 root 被执行了好几次 renderRoot，第一次 renderRoot 实际上就把所有的任务做完了
    // 所以即使后面再做也根本没任何用，这里就直接 bailout 了
    // 实际上，firstPendingTime 是在 scheduleWork 里设置的，commitRoot 的时候把它还原
    // 也就是说，要想不 bailout，必须在这次 renderRoot 之前的 commitRoot 之后，这次 renderRoot 之前有一次 scheduleWork，而不能是直接去调 renderRoot
    // 所以，先 scheduleWork，然后接着执行两次 renderRoot（不管是同步接连执行，还是分开的异步执行）
    // 第二次 renderRoot 都会 bailout（因为第二次 renderRoot 前没有 scheduleWork，只有第一次 renderRoot 之前有 scheduleWork）
    // 所以上面虽然会执行两次 renderRoot，但是第二次直接 bailout 了，可以忽略不计

    // Tip：第二次为什么没有往 taskQueue 里面 push？（因为调的是 scheduleSyncCallback 而不是 scheduleCallback）
    // Tip: DOM 被干掉了（界面上没有了），但是 DOM 对应的 js 的数据还在（当然 parent 和 sibling 变为 null 了），也就是你仍然可以引用到，所以 React 可以
    //      一直往 parentNode 找来找到 root，如果找得到说明这个 DOM 还在界面上，如果找不到说明已经被干掉/ummount 了，所以也就不再走捕获和冒泡阶段（当前从逻辑上来说被干掉了自然也不该触发）
    // Tip：后面执行 taskQueue 的时候实际上并没有 flushSyncCallbackQueueImpl 了（第二个 task 的 callback 为 null）
    //      这是因为调完 scheduleSyncCallback 之后调 flushSyncCallbackQueue 的时候 cancel 掉了。原因是执行 flushSyncCallbackQueue 就会执行 flushSyncCallbackQueueImpl
    //      所以不需要后面再执行了，简单的来说就是既可能外部执行完 scheduleSyncCallback 之后马上就调了 flushSyncCallbackQueue，也可能没有调，而是 scheduleSyncCallback 自己设置的 flushSyncCallbackQueueImpl
    //      后面某个时间到了触发了，谁先执行就清空，没必要执行两次 flushSyncCallbackQueueImpl
    // DOM.render 的流程也是这样吗？应该不是，只是期望的结果是一样的，所以 concurrent 才需要进行这样的流程保证这种一样？贴对比图
    it('ignores discrete events on a pending removed element', async () => {
      const disableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      function Form() {
        const [active, setActive] = React.useState(true);
        function disableForm() {
          setActive(false);
        }

        return (
          <div>
            <button onClick={disableForm} ref={disableButtonRef}>
              Disable
            </button>
            {active ? <button ref={submitButtonRef}>Submit</button> : null}
          </div>
        );
      }

      const root = ReactDOM.createRoot(container);
      await act(async () => {
        root.render(<Form />);
      });

      const disableButton = disableButtonRef.current;
      expect(disableButton.tagName).toBe('BUTTON');

      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // Dispatch a click event on the Disable-button.
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      disableButton.dispatchEvent(firstEvent);

      // The click event is flushed synchronously, even in concurrent mode.
      expect(submitButton.current).toBe(undefined);
    });

    it('ignores discrete events on a pending removed event listener', async () => {
      const disableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      let formSubmitted = false;

      function Form() {
        const [active, setActive] = React.useState(true);
        function disableForm() {
          setActive(false);
        }
        function submitForm() {
          formSubmitted = true; // This should not get invoked
        }
        function disabledSubmitForm() {
          // The form is disabled.
        }
        return (
          <div>
            <button onClick={disableForm} ref={disableButtonRef}>
              Disable
            </button>
            <button
              onClick={active ? submitForm : disabledSubmitForm}
              ref={submitButtonRef}>
              Submit
            </button>
          </div>
        );
      }

      const root = ReactDOM.createRoot(container);
      await act(async () => {
        root.render(<Form />);
      });

      const disableButton = disableButtonRef.current;
      expect(disableButton.tagName).toBe('BUTTON');

      // Dispatch a click event on the Disable-button.
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      await act(async () => {
        disableButton.dispatchEvent(firstEvent);
      });

      // There should now be a pending update to disable the form.

      // This should not have flushed yet since it's in concurrent mode.
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // In the meantime, we can dispatch a new client event on the submit button.
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      // This should force the pending update to flush which disables the submit button before the event is invoked.
      await act(async () => {
        submitButton.dispatchEvent(secondEvent);
      });

      // Therefore the form should never have been submitted.
      expect(formSubmitted).toBe(false);
    });

    it('uses the newest discrete events on a pending changed event listener', async () => {
      const enableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      let formSubmitted = false;

      function Form() {
        const [active, setActive] = React.useState(false);
        function enableForm() {
          setActive(true);
        }
        function submitForm() {
          formSubmitted = true; // This should not get invoked
        }
        return (
          <div>
            <button onClick={enableForm} ref={enableButtonRef}>
              Enable
            </button>
            <button onClick={active ? submitForm : null} ref={submitButtonRef}>
              Submit
            </button>
          </div>
        );
      }

      const root = ReactDOM.createRoot(container);
      await act(async () => {
        root.render(<Form />);
      });

      const enableButton = enableButtonRef.current;
      expect(enableButton.tagName).toBe('BUTTON');

      // Dispatch a click event on the Enable-button.
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      await act(async () => {
        enableButton.dispatchEvent(firstEvent);
      });

      // There should now be a pending update to enable the form.

      // This should not have flushed yet since it's in concurrent mode.
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // In the meantime, we can dispatch a new client event on the submit button.
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      // This should force the pending update to flush which enables the submit button before the event is invoked.
      await act(async () => {
        submitButton.dispatchEvent(secondEvent);
      });

      // Therefore the form should have been submitted.
      expect(formSubmitted).toBe(true);
    });
  });

  it('regression test: does not drop passive effects across roots (#17066)', () => {
    const {useState, useEffect} = React;

    function App({label}) {
      const [step, setStep] = useState(0);
      useEffect(() => {
        if (step < 3) {
          setStep(step + 1);
        }
      }, [step]);

      // The component should keep re-rendering itself until `step` is 3.
      return step === 3 ? 'Finished' : 'Unresolved';
    }

    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    const containerC = document.createElement('div');

    ReactDOM.render(<App label="A" />, containerA);
    ReactDOM.render(<App label="B" />, containerB);
    ReactDOM.render(<App label="C" />, containerC);

    Scheduler.unstable_flushAll();

    expect(containerA.textContent).toEqual('Finished');
    expect(containerB.textContent).toEqual('Finished');
    expect(containerC.textContent).toEqual('Finished');
  });

  it('updates flush without yielding in the next event', () => {
    const root = ReactDOM.createRoot(container);

    function Text(props) {
      Scheduler.unstable_yieldValue(props.text);
      return props.text;
    }

    root.render(
      <>
        <Text text="A" />
        <Text text="B" />
        <Text text="C" />
      </>,
    );

    // Nothing should have rendered yet
    expect(container.textContent).toEqual('');

    // Everything should render immediately in the next event
    expect(Scheduler).toFlushAndYield(['A', 'B', 'C']);
    expect(container.textContent).toEqual('ABC');
  });

  it('unmounted roots should never clear newer root content from a container', () => {
    const ref = React.createRef();

    function OldApp() {
      const [value, setValue] = React.useState('old');
      function hideOnClick() {
        // Schedule a discrete update.
        setValue('update');
        // Synchronously unmount this root.
        ReactDOM.flushSync(() => oldRoot.unmount());
      }
      return (
        <button onClick={hideOnClick} ref={ref}>
          {value}
        </button>
      );
    }

    function NewApp() {
      return <button ref={ref}>new</button>;
    }

    const oldRoot = ReactDOM.createRoot(container);
    act(() => {
      oldRoot.render(<OldApp />);
    });

    // Invoke discrete event.
    ref.current.click();

    // The root should now be unmounted.
    expect(container.textContent).toBe('');

    // We can now render a new one.
    const newRoot = ReactDOM.createRoot(container);
    ReactDOM.flushSync(() => {
      newRoot.render(<NewApp />);
    });
    ref.current.click();

    expect(container.textContent).toBe('new');
  });
});
