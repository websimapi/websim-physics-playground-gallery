const { useState, useEffect, useSyncExternalStore } = React;

function PhysicsPlayground() {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const room = new WebsimSocket();
  
  // Get physics artifacts from the database
  const artifacts = useSyncExternalStore(
    room.collection('physics_artifact').subscribe,
    () => room.collection('physics_artifact').getList()
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      // Get AI response for physics simulation
      const response = await fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Create an interactive physics demonstration or simulation based on the following prompt. 
          The response must be valid JSON matching this interface:

          interface PhysicsArtifact {
            html: string;      // The HTML code for the demonstration
            css: string;       // The CSS styles for the demonstration
            js: string;        // The JavaScript code for the demonstration
            title: string;     // A short title describing the demonstration
            description: string; // A longer description explaining the physics concept
          }

          {
            "html": "<div class='container'><svg width='300' height='200'>...</svg></div>",
            "css": ".container { ... }",
            "js": "const svg = document.querySelector('svg'); ...",
            "title": "Simple Pendulum Simulation",
            "description": "This demonstration shows a pendulum swinging under the influence of gravity..."
          }

          The code should be self-contained and use SVG for graphics where possible.
          Ensure all code is properly escaped for JSON.
          
          Create a physics demonstration for: ${prompt}`,
          data: prompt
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      // Validate the response has all required fields
      if (!artifactCode.html || !artifactCode.css || !artifactCode.js || !artifactCode.title || !artifactCode.description) {
        throw new Error('Invalid response format from AI');
      }

      // Store the artifact in the database
      await room.collection('physics_artifact').create({
        prompt,
        code: artifactCode,
        title: artifactCode.title,
        description: artifactCode.description
      });

      setPrompt('');
    } catch (err) {
      console.error('Error details:', err);
      setError('Failed to create physics simulation. Please try again with a different prompt.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="input-section">
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe a physics concept or experiment..."
              disabled={isSubmitting}
            />
            <button type="submit" disabled={isSubmitting || !prompt.trim()}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="gallery">
        {artifacts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(artifact => (
          <PhysicsContainer key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}

function PhysicsContainer({ artifact }) {
  const containerRef = React.useRef();
  const room = new WebsimSocket();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [mountError, setMountError] = useState(null);
  const sandboxId = `physics-sandbox-${artifact.id}`;

  useEffect(() => {
    let cleanup = () => {};
    
    // Wrap in try-catch to handle potential mounting errors
    try {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const sandbox = container.querySelector('.physics-content');
      
      if (!sandbox) {
        throw new Error('Could not find physics content container');
      }

      // Check if shadow root already exists and remove it
      if (sandbox.shadowRoot) {
        sandbox.innerHTML = '';
        try {
          sandbox.detachShadow();
        } catch (e) {
          // Some browsers might not support detachShadow
          console.warn('Could not detach shadow root:', e);
        }
      }

      // Create a new shadow root for isolation
      const shadow = sandbox.attachShadow({ mode: 'closed' });
      
      // Create container for the physics content
      const physicsContainer = document.createElement('div');
      physicsContainer.id = sandboxId;
      
      // Add the HTML content
      physicsContainer.innerHTML = artifact.code.html || '';
      
      // Add scoped styles
      const style = document.createElement('style');
      style.textContent = `
        /* Reset styles within shadow DOM */
        :host {
          all: initial;
          display: block;
          position: relative;
          width: 100%;
          height: 100%;
          contain: content;
        }
        /* Default safety styles */
        div {
          position: relative;
          max-width: 100%;
        }
        ${artifact.code.css || ''}
      `;
      
      // Append style and content to shadow root
      shadow.appendChild(style);
      shadow.appendChild(physicsContainer);
      
      // Create and add the script in a safe way
      const script = document.createElement('script');
      const safeId = String(artifact.id).replace(/[^\w-]/g, '');
      
      script.textContent = `
        (function() {
          try {
            const root = document.currentScript.parentElement;
            const container = root.getElementById('${sandboxId}');
            
            if (!container) {
              throw new Error('Container not found');
            }

            // Utility functions for selecting elements within this shadow DOM only
            const getElement = (selector) => container.querySelector(selector);
            const getElements = (selector) => container.querySelectorAll(selector);
            
            // Sandbox console logs
            const sandboxConsole = {
              log: function() {
                console.log('[Physics ' + '${safeId}' + ']:', ...Array.from(arguments));
              },
              error: function() {
                console.error('[Physics ' + '${safeId}' + ']:', ...Array.from(arguments));
              },
              warn: function() {
                console.warn('[Physics ' + '${safeId}' + ']:', ...Array.from(arguments));
              }
            };

            // Animation frame and timeout tracking for cleanup
            let activeAnimationFrames = new Set();
            let activeTimeouts = new Set();

            // Create a sandboxed environment
            const sandbox = {
              console: sandboxConsole,
              container,
              getElement,
              getElements,
              requestAnimationFrame: (cb) => {
                const id = window.requestAnimationFrame((timestamp) => {
                  activeAnimationFrames.delete(id);
                  cb(timestamp);
                });
                activeAnimationFrames.add(id);
                return id;
              },
              cancelAnimationFrame: (id) => {
                activeAnimationFrames.delete(id);
                window.cancelAnimationFrame(id);
              },
              setTimeout: (cb, delay) => {
                const id = window.setTimeout(() => {
                  activeTimeouts.delete(id);
                  cb();
                }, delay);
                activeTimeouts.add(id);
                return id;
              },
              clearTimeout: (id) => {
                activeTimeouts.delete(id);
                window.clearTimeout(id);
              },
              Math: Object.create(Math)
            };

            // Run the physics code in the sandbox
            with (sandbox) {
              (function() {
                ${artifact.code.js || ''}
              })();
            }

            // Set up cleanup function
            root.cleanup = function() {
              activeAnimationFrames.forEach(id => window.cancelAnimationFrame(id));
              activeTimeouts.forEach(id => window.clearTimeout(id));
              activeAnimationFrames.clear();
              activeTimeouts.clear();
            };
          } catch (error) {
            console.error('[Physics ${safeId}] Error:', error);
          }
        })();
      `;
      
      shadow.appendChild(script);

      // Store cleanup function
      cleanup = () => {
        if (sandbox.shadowRoot) {
          try {
            if (shadow.querySelector('script')?.cleanup) {
              shadow.querySelector('script').cleanup();
            }
            sandbox.innerHTML = '';
          } catch (e) {
            console.warn('Cleanup error:', e);
          }
        }
      };
    } catch (error) {
      console.error('Mount error:', error);
      setMountError(error.message);
    }

    // Return cleanup function
    return () => {
      try {
        cleanup();
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    };
  }, [artifact.id, artifact.code]);

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this physics artifact?')) return;
    
    setIsDeleting(true);
    try {
      await room.collection('physics_artifact').delete(artifact.id);
    } catch (error) {
      console.error('Failed to delete artifact:', error);
      alert('Failed to delete artifact. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const isOwner = artifact.username === room.party.client.username;

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('default', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <div className="physics-container" ref={containerRef}>
      {isOwner && (
        <button 
          className="delete-button" 
          onClick={handleDelete}
          disabled={isDeleting}
          title="Delete this artifact"
        >
          ×
        </button>
      )}
      <div className="physics-content">
        {mountError && (
          <div className="error">
            Failed to load physics simulation: {mountError}
          </div>
        )}
      </div>
      <div className="physics-meta">
        <img 
          className="avatar"
          src={`https://images.websim.ai/avatar/${artifact.username}`}
          alt={artifact.username}
        />
        <span>{artifact.username}</span>
        <span>•</span>
        <span>{new Date(artifact.created_at).toLocaleDateString()}</span>
        <button 
          className="details-toggle" 
          onClick={() => setIsDetailsOpen(!isDetailsOpen)}
        >
          Details
          <span className={`chevron ${isDetailsOpen ? 'open' : ''}`}>▼</span>
        </button>
      </div>
      <div className={`details-dropdown ${isDetailsOpen ? 'open' : 'closed'}`}>
        <div className="details-section">
          <div className="details-label">Title</div>
          <div className="details-value">{artifact.code.title}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Description</div>
          <div className="details-value">{artifact.code.description}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Original Prompt</div>
          <div className="details-value">{artifact.prompt}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Created</div>
          <div className="details-value">{formatDate(artifact.created_at)}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Created By</div>
          <div className="details-value">{artifact.username}</div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<PhysicsPlayground />, document.getElementById('root'));