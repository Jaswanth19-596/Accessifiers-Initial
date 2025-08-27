// server.js - Node.js backend for Accessibility Insights integration
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Global error handlers (prevent crash on unexpected errors)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Create temp directory for reports
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Accessibility Insights scan endpoint
app.post('/api/accessibility-insights', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL is required',
        message: 'Please provide a valid URL to scan',
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid URL',
        message:
          'Please provide a valid URL (including protocol, e.g. https://example.com).',
      });
    }

    console.log(`Starting Accessibility Insights scan for: ${parsedUrl.href}`);

    const timestamp = Date.now();
    const reportDir = path.join(tempDir, `scan_${timestamp}`);

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Run the scan using CLI
    const cli = 'npx';
    const args = [
      'accessibility-insights-scan',
      '--crawl',
      '--url',
      parsedUrl.href,
      '--output',
      reportDir,
      '--restart',
    ];

    console.log(`Running command: ${cli} ${args.join(' ')}`);

    console.log();

    // Execute CLI command
    const scanResult = await new Promise((resolve, reject) => {
      const startTime = Date.now();
      console.log('Starting scan process...');

      const childProcess = execFile(
        cli,
        args,
        {
          timeout: 300000,
          maxBuffer: 20 * 1024 * 1024,
          cwd: __dirname,
        },
        (error, stdout, stderr) => {
          const duration = Date.now() - startTime;
          console.log(`Scan completed in ${duration}ms`);

          if (error) {
            console.error('CLI scan error:', error);
            return reject(new Error(`Scan failed: ${error.message}`));
          }

          if (stderr) {
            console.warn('CLI stderr:', stderr);
          }

          resolve({ stdout, stderr });
        }
      );

      // Log progress every 30 seconds
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        console.log(
          `Scan still running... elapsed: ${Math.round(elapsed / 1000)}s`
        );
      }, 30000);

      childProcess.on('close', () => {
        clearInterval(progressInterval);
      });
    });

    console.log('Scan completed, processing results...');

    const reportFiles = fs.readdirSync(reportDir);
    let jsonReport = null;

    console.log('Available report files:', reportFiles);

    // Function to parse scan results from key_value_stores
    const parseCrawlResults = (reportDir) => {
      const results = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        totalUrls: 0,
        failedUrls: 0,
        passedUrls: 0,
      };

      try {
        // Look for key_value_stores directory which contains individual scan results
        const kvStoresPath = path.join(reportDir, 'key_value_stores');
        if (fs.existsSync(kvStoresPath)) {
          const scanResultsPath = path.join(kvStoresPath, 'scan-results');
          if (fs.existsSync(scanResultsPath)) {
            const resultFiles = fs
              .readdirSync(scanResultsPath)
              .filter((f) => f.endsWith('.report.html'));
            console.log(`Found ${resultFiles.length} individual page reports`);

            results.totalUrls = resultFiles.length;
            let failedUrlCount = 0;
            let passedUrlCount = 0;

            // Parse each individual report
            for (const resultFile of resultFiles.slice(0, 50)) {
              // Limit to first 50 to avoid overwhelming
              try {
                const reportPath = path.join(scanResultsPath, resultFile);
                const htmlContent = fs.readFileSync(reportPath, 'utf8');

                // Extract violations from HTML content by looking for specific patterns
                const violationMatches = htmlContent.match(
                  /color-contrast.*?(\d+)\s*Failed/gi
                );
                if (violationMatches && violationMatches.length > 0) {
                  failedUrlCount++;
                  // Extract URL from the HTML content
                  const urlMatch = htmlContent.match(
                    /target-blank.*?href="([^"]+)"/i
                  );
                  const url = urlMatch ? urlMatch[1] : `page-${resultFile}`;

                  results.violations.push({
                    id: 'color-contrast',
                    impact: 'serious',
                    description:
                      'Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
                    helpUrl:
                      'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
                    nodes: [
                      {
                        target: [url],
                        html: 'Multiple elements with insufficient color contrast',
                        failureSummary:
                          'Color contrast ratio does not meet WCAG AA standards',
                      },
                    ],
                  });
                } else {
                  passedUrlCount++;
                }

                // Look for passed checks
                const passedMatches = htmlContent.match(/(\d+)\s*Passed/gi);
                if (passedMatches && passedMatches.length > 0) {
                  const passedCount = parseInt(
                    passedMatches[0].match(/\d+/)[0]
                  );
                  if (passedCount > 0) {
                    results.passes.push({
                      id: 'multiple-checks',
                      description: `${passedCount} accessibility checks passed`,
                      nodes: passedCount,
                    });
                  }
                }
              } catch (fileError) {
                console.warn(
                  `Could not parse ${resultFile}:`,
                  fileError.message
                );
              }
            }

            results.failedUrls = failedUrlCount;
            results.passedUrls = passedUrlCount;
          }
        }
      } catch (error) {
        console.error('Error parsing crawl results:', error);
      }

      return results;
    };

    // Try to parse crawl results first
    jsonReport = parseCrawlResults(reportDir);

    // If we didn't get meaningful results, try other parsing methods
    if (jsonReport.violations.length === 0 && jsonReport.passes.length === 0) {
      // Look for SARIF or JSON report files
      for (const file of reportFiles) {
        const filePath = path.join(reportDir, file);

        if (file.endsWith('.sarif') || file.endsWith('.json')) {
          try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(fileContent);

            if (file.endsWith('.sarif')) {
              console.log('Processing SARIF file:', file);
              jsonReport = {
                violations: [],
                passes: [],
                incomplete: [],
                inapplicable: [],
              };

              if (parsedData.runs && parsedData.runs.length > 0) {
                const results = parsedData.runs[0].results || [];
                results.forEach((result) => {
                  if (result.level === 'error' || result.kind === 'fail') {
                    jsonReport.violations.push({
                      id: result.ruleId,
                      impact: result.level || 'serious',
                      description: result.message?.text || '',
                      helpUrl: result.helpUri || '',
                      nodes: result.locations?.map((loc) => ({
                        target: [
                          loc.physicalLocation?.artifactLocation?.uri ||
                            'unknown',
                        ],
                        html: loc.physicalLocation?.region?.snippet?.text || '',
                        failureSummary: result.message?.text || '',
                      })),
                    });
                  } else {
                    jsonReport.passes.push({
                      id: result.ruleId,
                      description: result.message?.text || '',
                      nodes: result.locations?.length || 0,
                    });
                  }
                });
              }
            } else {
              jsonReport = parsedData;
            }
            break;
          } catch (parseError) {
            console.warn(`Could not parse ${file}:`, parseError.message);
          }
        }
      }
    }

    if (
      !jsonReport ||
      (jsonReport.violations.length === 0 && jsonReport.passes.length === 0)
    ) {
      const htmlFile = reportFiles.find((file) => file.endsWith('.html'));
      if (htmlFile) {
        console.log('Found HTML report:', htmlFile);
        jsonReport = {
          violations: [],
          passes: [],
          incomplete: [],
          inapplicable: [],
          message:
            'HTML report generated successfully. Detailed analysis available in HTML format.',
        };
      }
    }

    if (!jsonReport) {
      jsonReport = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
      };
    }

    const processedResults = {
      url: parsedUrl.href,
      timestamp: new Date().toISOString(),
      summary: {
        violations: jsonReport.violations?.length || 0,
        passes: jsonReport.passes?.length || 0,
        incomplete: jsonReport.incomplete?.length || 0,
        inapplicable: jsonReport.inapplicable?.length || 0,
        totalUrls: jsonReport.totalUrls || 0,
        failedUrls: jsonReport.failedUrls || 0,
        passedUrls: jsonReport.passedUrls || 0,
      },
      violations:
        jsonReport.violations?.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          description: violation.description,
          help: violation.helpUrl || null,
          nodes:
            violation.nodes?.map((node) => ({
              target: node.target,
              html: node.html?.substring(0, 200),
              failureSummary: node.failureSummary,
            })) || [],
        })) || [],
      passes:
        jsonReport.passes?.slice(0, 10)?.map((pass) => ({
          id: pass.id,
          description: pass.description,
          nodes: pass.nodes?.length || pass.nodes || 0,
        })) || [],
    };

    setTimeout(() => {
      try {
        fs.rmSync(reportDir, { recursive: true, force: true });
      } catch (error) {
        console.error('Error cleaning up temp files:', error);
      }
    }, 60000);

    res.json(processedResults);
  } catch (error) {
    console.error('Accessibility Insights scan error:', error);
    res.status(500).json({
      error: 'Scan failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'Accessibility Insights API Server',
    endpoints: ['POST /api/accessibility-insights - Run accessibility scan'],
  });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Accessibility Insights API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(
    `🔍 Scan endpoint: POST http://localhost:${PORT}/api/accessibility-insights`
  );
});
