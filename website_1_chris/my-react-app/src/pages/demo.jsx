import { useState } from 'react'
import GameMock from '../components/gamemock.jsx'
import './demo.css'

const steps = [
  {
    title: 'Four answers, no question',
    body: 'Every round opens with four answer options and nothing else. The question itself stays hidden.'
  },
  {
    title: 'Work out the question',
    body: 'Look for what the options have in common. Stuck? Spend points on a hint that narrows it down.'
  },
  {
    title: 'Bid your points',
    body: 'Back the answer you believe fits the hidden question. The more certain you are, the more you bid.'
  },
  {
    title: 'The reveal',
    body: 'The question appears. Bid on the right answer and your points grow — guess wrong and you lose the bid.'
  }
]

function Demo() {
  const [current, setCurrent] = useState(0)

  function goTo(index) {
    setCurrent((index + steps.length) % steps.length)
  }

  return (
    <section className="demo">
      <div className="demo-text">
        <h1>How it works</h1>
        <p className="demo-intro">
          BlindedFlutter turns a quiz on its head: you see the answers first and bid points on what you
          think the question was.
        </p>

        <ol className="demo-list">
          {steps.map(function (step, index) {
            return (
              <li key={step.title}>
                <button
                  type="button"
                  className={index === current ? 'demo-step active' : 'demo-step'}
                  onClick={() => goTo(index)}
                  aria-current={index === current ? 'step' : undefined}
                >
                  <span className="demo-number">{index + 1}</span>
                  <span>
                    <strong>{step.title}</strong>
                    <span className="demo-body">{step.body}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="demo-stage">
        <GameMock step={current} />

        <div className="demo-controls">
          <button type="button" onClick={() => goTo(current - 1)} aria-label="Previous step">
            ←
          </button>
          <span aria-live="polite">
            Step {current + 1} of {steps.length}
          </span>
          <button type="button" onClick={() => goTo(current + 1)} aria-label="Next step">
            →
          </button>
        </div>
      </div>
    </section>
  )
}

export default Demo
