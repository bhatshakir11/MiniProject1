import React from "react";
import { Link, useNavigate } from "react-router-dom";

const Navbar = () => {
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };
  return (
    <nav className="bg-gray-900/80 backdrop-blur-md text-white px-6 py-4 flex items-center justify-between shadow-lg border-b border-white/10 relative z-10 transition-all">
      <div className="font-bold text-xl tracking-wide bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
        <Link to="/dashboard">Cyber Hygiene Vault</Link>
      </div>
      <div className="flex items-center space-x-6">
        <Link to="/dashboard" className="hover:text-cyan-400 transition-colors duration-300">Dashboard</Link>
        <Link to="/vault" className="hover:text-cyan-400 transition-colors duration-300">Vault</Link>
        <Link to="/notes" className="hover:text-cyan-400 transition-colors duration-300">Notes</Link>
        <Link to="/reports" className="hover:text-cyan-400 transition-colors duration-300">Reports</Link>
        <button onClick={handleLogout} className="ml-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 px-4 py-2 rounded-lg text-white btn-futuristic shadow-lg">Logout</button>
      </div>
    </nav>
  );
};

export default Navbar;
