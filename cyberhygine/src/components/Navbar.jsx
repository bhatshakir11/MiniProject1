import React from "react";
import { Link, useNavigate } from "react-router-dom";

const Navbar = () => {
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };
  return (
    <nav className="bg-gray-900 text-white px-6 py-3 flex items-center justify-between shadow">
      <div className="font-bold text-xl tracking-wide">
        <Link to="/dashboard">Cyber Hygiene Vault</Link>
      </div>
      <div className="space-x-4">
        <Link to="/dashboard" className="hover:text-blue-400">Dashboard</Link>
        <Link to="/vault" className="hover:text-blue-400">Vault</Link>
        <Link to="/notes" className="hover:text-blue-400">Notes</Link>
        <Link to="/reports" className="hover:text-blue-400">Reports</Link>
        <button onClick={handleLogout} className="ml-4 bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-white">Logout</button>
      </div>
    </nav>
  );
};

export default Navbar;
