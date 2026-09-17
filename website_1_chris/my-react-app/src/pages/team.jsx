import chris from '../assets/chris.png'
import housayn from '../assets/housayn.png'
import boas from '../assets/boas.png'
import './team.css'

function Team() {

  const teamMembers = [

    {name: 'Christoffer', photo: chris, description: 'Christoffer is a Software Engineering student with a passion for technology, game development and back-end systems'},
    {name: 'Housayn', photo: housayn, description: 'Housayn is a Software Engineering student with holistic knowledge of frontend design.'},
    {name: 'Boas', photo: boas, description: 'Boas is a Software Engineering student with knowledge of C#, Python, React, and Java/TypeScript.'},
    {name: 'Aleksander', photo: 'https://via.placeholder.com/150', description: 'Aleksander is a Software Engineering student with a focus on user experience and interface design.'}

  ];


  return (
    <section id="center">
      <h1>Meet the Team!</h1>
      <p>

        We are a team of four Software Engineering students creating a game-based learning system.

      </p>
      <div className="team-grid">
        {
          teamMembers.map(function (member) {
            return (
              <div className="member-card" key={member.name}>
                <img src={member.photo} alt={member.name} />
                <h2>{member.name}</h2>
                <h3>{member.description}</h3>
              </div>
            );
          })
        }
      </div>

    </section>
  )
}

export default Team
