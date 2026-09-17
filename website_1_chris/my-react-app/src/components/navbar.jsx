import {NavLink} from "react-router-dom"
import './navbar.css'

function Navbar() {
    return (
        <nav className="navbar" aria-label="Main">
            <ul>
                <li><NavLink to="/" end> Home</NavLink></li>
                <li><NavLink to="/about" end> About</NavLink></li>
                <li><NavLink to="/team" end> Team</NavLink></li>
                <li><NavLink to="/demo" end>Demo</NavLink></li>
            </ul>
        </nav>
    )
}

export default Navbar