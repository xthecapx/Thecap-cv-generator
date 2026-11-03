import * as React from 'react';

import { PDFViewer } from '@react-pdf/renderer';
import { documentStyles, markdownToCv, CvDocument, validateCvMarkdown } from '@thecap-cv/components';
import type { CvRenderOptions } from '@thecap-cv/components';

interface ReactViewProps {
    markdown: string;
    options?: CvRenderOptions;
}

export const ReactView: React.FC<ReactViewProps> = ({ markdown, options }) => {
  const { isValid, errors } = validateCvMarkdown(markdown);

  if (!isValid) {
    return (
      <div className="react-view-container" style={{ padding: '20px', color: '#ff4444' }}>
        <h3>Invalid cv format</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {errors.map((error, index) => (
            <li key={index} style={{ marginBottom: '8px' }}>❌ {error}</li>
          ))}
        </ul>
        <p style={{ marginTop: '16px' }}>
          Please check the correct CV format in our{' '}
          <a 
            href="https://github.com/xthecapx/cv-generator#readme" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#4444ff' }}
          >
            documentation
          </a>
        </p>
      </div>
    );
  }

  const cvData = markdownToCv(markdown);

  return (
      <div className="react-view-container">
        <PDFViewer style={documentStyles.viewer}>
          <CvDocument cvData={cvData} options={options} />
        </PDFViewer>
      </div>
  );
};
