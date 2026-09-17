import './gamemock.css'

const QUESTION = 'Which mountain is the highest above sea level?'

const answers = [
  { label: 'A', text: 'Mount Everest', correct: true },
  { label: 'B', text: 'K2' },
  { label: 'C', text: 'Denali' },
  { label: 'D', text: 'Mont Blanc' }
]

function GameMock({ step }) {
  const hintShown = step >= 1
  const bidPlaced = step >= 2
  const revealed = step >= 3

  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <span>Round 3 of 10</span>
        <span className="mock-points">{revealed ? '1 400' : '1 000'} pts</span>
      </div>

      <div className={revealed ? 'mock-question revealed' : 'mock-question'}>
        {revealed ? QUESTION : '? ? ?'}
      </div>

      <ul className="mock-answers">
        {answers.map(function (answer) {
          const picked = bidPlaced && answer.correct
          const right = revealed && answer.correct

          return (
            <li
              key={answer.label}
              className={right ? 'mock-answer correct' : picked ? 'mock-answer picked' : 'mock-answer'}
            >
              <span className="mock-key">{answer.label}</span>
              <span className="mock-text">{answer.text}</span>
              {picked && <span className="mock-bid">400 pts</span>}
            </li>
          )
        })}
      </ul>

      <div className={hintShown ? 'mock-hint' : 'mock-hint empty'}>
        <span>{hintShown ? 'Hint: they are all mountains.' : 'No hint bought yet'}</span>
        <span className="mock-buy">Buy a hint — 100 pts</span>
      </div>
    </div>
  )
}

export default GameMock
