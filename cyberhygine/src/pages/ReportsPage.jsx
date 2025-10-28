import React from "react";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";

const ReportsPage = () => {
  const handleDownload = () => {
    // Replace with actual API call to download PDF
    window.open("http://localhost:8000/api/report", "_blank");
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <AnimatedBackground />
      <Navbar />
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10">
        <h2 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-8 animate-fade-in">Reports</h2>
        <div className="glass-card rounded-2xl p-8 flex flex-col items-center animate-fade-in">
          <p className="text-gray-200 text-lg mb-6 text-center">Download your cyber hygiene report as a PDF.</p>
          <button
            onClick={handleDownload}
            className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white px-8 py-4 rounded-lg font-semibold btn-futuristic shadow-lg transition-all text-lg"
          >
            Download PDF Report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
