import React, { useState } from 'react';

const Scanner = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [backendUrl, setBackendUrl] = useState(process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001');
  const [showSettings, setShowSettings] = useState(false);


  // Accessibility Insights API call (to your backend)
  const callAccessibilityInsights = async (testUrl) => {
    try {
      const response = await fetch(`${backendUrl}/api/scan-accessibility`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: testUrl }),
      });

      const data = await response.json();
      
      // Handle error responses with user-friendly messages
      if (!response.ok) {
        throw new Error(data.error || `Accessibility Insights API error: ${response.status} ${response.statusText}`);
      }
      
      if (data.success && data.accessibility) {
        return {
          summary: {
            violations: data.accessibility.violations?.length || 0,
            passes: data.accessibility.passes?.length || 0,
            incomplete: data.accessibility.incomplete?.length || 0,
            inapplicable: data.accessibility.inapplicable?.length || 0,
          },
          violations: data.accessibility.violations || [],
          passes: data.accessibility.passes || [],
          incomplete: data.accessibility.incomplete || [],
          inapplicable: data.accessibility.inapplicable || [],
          url: data.scannedUrl,
          timestamp: data.timestamp,
          score: data.score
        };
      }
      
      // If not successful, throw with the error message
      if (!data.success) {
        throw new Error(data.error || 'Scan failed');
      }
      
      return data;
    } catch (error) {
      console.error('Accessibility Insights Error:', error);
      throw error;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!url) {
      setError('Please enter a valid URL');
      return;
    }

    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url)) {
      setError('Please enter a valid URL starting with http:// or https://');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);

    try {
      console.log('Starting scan for:', url);

      try {
        const insightsResults = await callAccessibilityInsights(url);

        const finalResults = {
          url: url,
          timestamp: new Date().toISOString(),
          insights: insightsResults,
          insightsError: null,
        };

        setResults(finalResults);
      } catch (innerErr) {
        const finalResults = {
          url: url,
          timestamp: new Date().toISOString(),
          insights: null,
          insightsError: innerErr.message,
        };
        setResults(finalResults);
        setError('Scan failed. Please check your settings and try again.');
      }
    } catch (err) {
      setError('Failed to scan the website. Please try again.');
      console.error('Scan error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (impact) => {
    switch (impact) {
      case 'critical':
        return 'text-red-700 bg-red-100 border-red-200';
      case 'serious':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'moderate':
        return 'text-yellow-700 bg-yellow-100 border-yellow-200';
      case 'minor':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  // Calculate comprehensive weighted accessibility score
  const calculateAccessibilityScore = () => {
    if (!results || !results.insights || !results.insights.score) return { score: 0, breakdown: null };

    // Severity weights - higher = more impact on score
    const backendScore = results.insights.score.score;

    let breakdown = {
      axeCritical: 0,
      axeSerious: 0,
      axeModerate: 0,
      axeMinor: 0,
      totalViolations: 0,
      totalPasses: 0
    };

    // Process Accessibility Insights (axe-core) results
    if (results.insights?.violations) {
      results.insights.violations.forEach(violation => {
        const nodeCount = violation.nodes?.length || 1;
        
        switch (violation.impact) {
          case 'critical':
            breakdown.axeCritical += nodeCount;
            break;
          case 'serious':
            breakdown.axeSerious += nodeCount;
            break;
          case 'moderate':
            breakdown.axeModerate += nodeCount;
            break;
          default:
            breakdown.axeMinor += nodeCount;
        }
      });

      breakdown.totalViolations = results.insights.summary?.violations || 0;
      breakdown.totalPasses = results.insights.summary?.passes || 0;
    }

    return { score: backendScore, breakdown };
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600 bg-green-50 border-green-500';
    if (score >= 70) return 'text-yellow-600 bg-yellow-50 border-yellow-500';
    if (score >= 50) return 'text-orange-600 bg-orange-50 border-orange-500';
    return 'text-red-600 bg-red-50 border-red-500';
  };

  const getScoreLabel = (score) => {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Needs Improvement';
    return 'Poor';
  };

  const { score: accessibilityScore, breakdown: scoreBreakdown } = calculateAccessibilityScore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Accessibility Scanner
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Real-time accessibility analysis using Accessibility Insights (Axe-core)
          </p>
          <p className="text-sm text-gray-500">
            Built for the Accessibility Ratings Project
          </p>
        </div>

        {/* Settings Toggle */}
        <div className="mb-6 text-center">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {showSettings ? 'Hide Settings' : 'Show Settings'}
          </button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8 border-l-4 border-yellow-400">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Configuration
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label
                  htmlFor="backendUrl"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Backend URL
                </label>
                <input
                  type="text"
                  id="backendUrl"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="http://localhost:3001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  URL of your Node.js backend running accessibility-insights-scan
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scan Form */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-4"
          >
            <div className="flex-1">
              <label
                htmlFor="url"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Website URL
              </label>
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg"
                disabled={loading}
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={loading || !url}
                className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {loading ? 'Scanning...' : 'Scan Website'}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <span className="text-red-700">{error}</span>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Scanning Website...
            </h3>
            <p className="text-gray-600">
              Running Accessibility Insights analysis. This may take a few moments.
            </p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-8">
            {/* Overall Accessibility Score */}
            <div className={`bg-white rounded-lg shadow-lg p-8 border-l-4 ${getScoreColor(accessibilityScore)}`}>
              <div className="flex flex-col md:flex-row items-center justify-between">
                <div className="text-center md:text-left mb-4 md:mb-0">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    Accessibility Score
                  </h2>
                  <p className="text-gray-600">
                    Accessibility score from Accessibility Insights analysis
                  </p>
                </div>
                <div className="text-center">
                  <div className={`text-6xl font-bold ${getScoreColor(accessibilityScore).split(' ')[0]}`}>
                    {accessibilityScore}
                  </div>
                  <div className={`text-lg font-medium ${getScoreColor(accessibilityScore).split(' ')[0]}`}>
                    {getScoreLabel(accessibilityScore)}
                  </div>
                </div>
              </div>

              {/* Score Breakdown */}
              {scoreBreakdown && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Score Breakdown</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="bg-red-50 p-3 rounded">
                      <div className="font-medium text-red-800">Critical Issues</div>
                      <div className="text-2xl font-bold text-red-600">
                        {scoreBreakdown.axeCritical}
                      </div>
                    </div>
                    <div className="bg-orange-50 p-3 rounded">
                      <div className="font-medium text-orange-800">Serious Issues</div>
                      <div className="text-2xl font-bold text-orange-600">
                        {scoreBreakdown.axeSerious}
                      </div>
                    </div>
                    <div className="bg-yellow-50 p-3 rounded">
                      <div className="font-medium text-yellow-800">Moderate Issues</div>
                      <div className="text-2xl font-bold text-yellow-600">
                        {scoreBreakdown.axeModerate}
                      </div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded">
                      <div className="font-medium text-blue-800">Minor Issues</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {scoreBreakdown.axeMinor}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-4 text-sm">
                    <div className="bg-green-50 p-2 px-4 rounded">
                      <span className="text-green-800 font-medium">Passed Checks: </span>
                      <span className="text-green-600 font-bold">{scoreBreakdown.totalPasses}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8">
              {/* Accessibility Insights Results */}
              <div className="bg-white rounded-lg shadow-lg">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">
                    Accessibility Insights
                  </h3>
                </div>

                <div className="p-6">
                  {results.insightsError ? (
                    <div className="text-center py-8">
                      <h4 className="text-lg font-medium text-gray-900 mb-2">
                        Insights Scan Failed
                      </h4>
                      <p className="text-red-600 text-sm">
                        {results.insightsError}
                      </p>
                      <div className="mt-4 p-3 bg-blue-50 rounded-md text-left">
                        <p className="text-sm text-blue-800 font-medium mb-2">
                          Backend Setup Required:
                        </p>
                        <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                          <li>Install: <code className="bg-blue-100 px-1 rounded">npm install</code></li>
                          <li>Run: <code className="bg-blue-100 px-1 rounded">npx playwright install</code></li>
                          <li>Start: <code className="bg-blue-100 px-1 rounded">node server.js</code></li>
                        </ol>
                      </div>
                    </div>
                  ) : results.insights ? (
                    <div className="space-y-4">
                      {/* Summary */}
                      {results.insights.summary && (
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Violations:</span>
                            <span className="font-medium text-red-600">
                              {results.insights.summary.violations}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Passes:</span>
                            <span className="font-medium text-green-600">
                              {results.insights.summary.passes}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Incomplete:</span>
                            <span className="font-medium text-yellow-600">
                              {results.insights.summary.incomplete}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Inapplicable:</span>
                            <span className="font-medium text-gray-500">
                              {results.insights.summary.inapplicable}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Violations Section */}
                      {results.insights.violations &&
                        results.insights.violations.length > 0 && (
                          <div className="space-y-3 mt-4">
                            <h4 className="font-medium text-gray-900 text-lg border-b pb-2">
                              Violations ({results.insights.violations.length})
                            </h4>
                            <div className="max-h-96 overflow-y-auto space-y-3">
                              {results.insights.violations.map((violation, index) => (
                                <details
                                  key={index}
                                  className={`border rounded-md ${getSeverityColor(violation.impact)}`}
                                >
                                  <summary className="p-3 cursor-pointer">
                                    <div className="inline-flex items-center justify-between w-full">
                                      <span className="font-medium text-sm">
                                        {violation.id}: {violation.description}
                                      </span>
                                      <span className="text-xs px-2 py-1 rounded-full bg-white bg-opacity-50 ml-2">
                                        {violation.impact} - {violation.nodes?.length || 0} element(s)
                                      </span>
                                    </div>
                                  </summary>
                                  <div className="p-3 pt-0 space-y-2">
                                    {violation.help && (
                                      <a
                                        href={violation.help}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center text-xs text-blue-600 hover:underline"
                                      >
                                        Learn how to fix
                                      </a>
                                    )}
                                    {violation.nodes && violation.nodes.length > 0 && (
                                      <div className="space-y-2">
                                        <p className="text-xs font-medium text-gray-700">Affected Elements:</p>
                                        {violation.nodes.slice(0, 10).map((node, nodeIndex) => (
                                          <div
                                            key={nodeIndex}
                                            className="bg-white bg-opacity-50 rounded p-2 text-xs"
                                          >
                                            <div className="font-mono text-gray-600 mb-1">
                                              {node.target?.join(' > ') || 'Unknown selector'}
                                            </div>
                                            {node.html && (
                                              <pre className="bg-gray-800 text-green-400 p-2 rounded text-xs overflow-x-auto max-w-full">
                                                {node.html}
                                              </pre>
                                            )}
                                            {node.failureSummary && (
                                              <p className="text-red-700 mt-1 text-xs">
                                                {node.failureSummary}
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                        {violation.nodes.length > 10 && (
                                          <p className="text-xs text-gray-500 italic">
                                            +{violation.nodes.length - 10} more elements...
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </details>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Incomplete Section */}
                      {results.insights.incomplete &&
                        results.insights.incomplete.length > 0 && (
                          <div className="space-y-3 mt-4">
                            <h4 className="font-medium text-gray-900 text-lg border-b pb-2">
                              Needs Review ({results.insights.incomplete.length})
                            </h4>
                            <div className="max-h-64 overflow-y-auto space-y-2">
                              {results.insights.incomplete.map((item, index) => (
                                <details
                                  key={index}
                                  className="border border-yellow-200 bg-yellow-50 rounded-md"
                                >
                                  <summary className="p-3 cursor-pointer">
                                    <span className="font-medium text-sm text-yellow-800">
                                      {item.id}: {item.description}
                                    </span>
                                    <span className="text-xs ml-2 text-yellow-600">
                                      ({item.nodes?.length || 0} element(s))
                                    </span>
                                  </summary>
                                  <div className="p-3 pt-0">
                                    {item.nodes && item.nodes.slice(0, 5).map((node, nodeIndex) => (
                                      <div key={nodeIndex} className="bg-white rounded p-2 text-xs mb-1">
                                        <div className="font-mono text-gray-600">
                                          {node.target?.join(' > ')}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Passes Section */}
                      {results.insights.passes &&
                        results.insights.passes.length > 0 && (
                          <div className="space-y-3 mt-4">
                            <details>
                              <summary className="font-medium text-gray-900 text-lg border-b pb-2 cursor-pointer">
                                Passed Rules ({results.insights.passes.length})
                              </summary>
                              <div className="max-h-48 overflow-y-auto mt-2 space-y-1">
                                {results.insights.passes.map((pass, index) => (
                                  <div
                                    key={index}
                                    className="flex justify-between items-center p-2 bg-green-50 rounded text-sm"
                                  >
                                    <span className="text-green-800">{pass.id}</span>
                                    <span className="text-xs text-green-600">
                                      {pass.nodes?.length || pass.nodes || 0} element(s)
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scanner;
