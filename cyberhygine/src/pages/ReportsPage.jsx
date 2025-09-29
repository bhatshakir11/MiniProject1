import React from "react";
import Navbar from "../components/Navbar";

const ReportsPage = () => {
  const handleDownload = () => {
    // Replace with actual API call to download PDF
    window.open("http://localhost:8000/api/report", "_blank");
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-blue-900">
      <Navbar />
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h2 className="text-3xl font-bold text-white mb-6">Reports</h2>
        <div className="bg-white/10 rounded-xl p-6 flex flex-col items-center">
          <p className="text-white mb-4">Download your cyber hygiene report as a PDF.</p>
          <button
            onClick={handleDownload}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-semibold"
          >
            Download PDF Report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
