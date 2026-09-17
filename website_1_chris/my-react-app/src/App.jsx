import { Routes, Route } from 'react-router-dom'
import Home from './pages/home.jsx'
import About from './pages/about.jsx'
import Team from './pages/team.jsx'
import Navbar from './components/navbar.jsx'
import Demo from './pages/demo.jsx'
import Documents from './pages/documents.jsx'
import './App.css'

function App() {
  return (
    <>
    <Navbar />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/team" element={<Team />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/documents" element={<Documents />} />
    </Routes>
    </>
  )
}

export default App