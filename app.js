function PhysicsPlayground() {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fullscreenArtifact, setFullscreenArtifact] = useState(null);
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

          The code should be self-contained and use SVG for graphics where possible! 
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

  if (fullscreenArtifact) {
    return (
      <FullscreenView
        artifact={fullscreenArtifact}
        onClose={() => setFullscreenArtifact(null)}
      />
    );
  }

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
          <PhysicsContainer 
            key={artifact.id} 
            artifact={artifact}
            onExpand={() => setFullscreenArtifact(artifact)}
          />
        ))}
      </div>
    </div>
  );
}

function FullscreenView({ artifact, onClose }) {
  return (
    <div className="fullscreen-overlay">
      <div className="fullscreen-header">
        <h2 className="fullscreen-title">{artifact.code.title}</h2>
        <button className="back-button" onClick={onClose}>
          <svg className="back-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          Back
        </button>
      </div>
      <div className="fullscreen-content">
        <div className="fullscreen-physics-content">
          <PhysicsContent artifact={artifact} />
        </div>
      </div>
    </div>
  );
}

function PhysicsContent({ artifact }) {
  const containerRef = React.useRef();
  const [mountError, setMountError] = useState(null);

  useEffect(() => {
    let mounted = true;
    let shadow = null;
    let cleanup = () => {};

    const initializePhysics = () => {
      try {
        if (!containerRef.current || !mounted) return;
        
        // Get the physics content container
        const sandbox = containerRef.current;
        if (!sandbox) {
          throw new Error('Container not found');
        }

        // Clear any existing content and shadow root
        if (sandbox.shadowRoot) {
          sandbox.shadowRoot.innerHTML = '';
        } else {
          shadow = sandbox.attachShadow({ mode: 'open' });
        }

        // Create wrapper element
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; height: 100%; position: relative;';
        shadow.appendChild(wrapper);

        // Add styles
        const styleElement = document.createElement('style');
        styleElement.textContent = `
          :host {
            all: initial;
            display: block;
            position: relative;
            width: 100%;
            height: 100%;
            contain: content;
          }
          ${artifact.code.css || ''}
        `;
        shadow.appendChild(styleElement);

        // Add HTML content
        wrapper.innerHTML = artifact.code.html || '';

        // Create a safe sandbox environment
        const sandboxEnvironment = {
          rootElement: wrapper,
          document: {
            getElementById: (id) => wrapper.querySelector('#' + id),
            querySelector: (sel) => wrapper.querySelector(sel),
            querySelectorAll: (sel) => wrapper.querySelectorAll(sel),
            createElement: (tag) => document.createElement(tag),
          },
          window: {
            innerWidth: wrapper.clientWidth,
            innerHeight: wrapper.clientHeight,
          },
          console: {
            log: (...args) => console.log(`[Physics ${artifact.id}]:`, ...args),
            error: (...args) => console.error(`[Physics ${artifact.id}]:`, ...args),
            warn: (...args) => console.warn(`[Physics ${artifact.id}]:`, ...args),
          },
          Math: Object.create(Math),
        };

        // Execute the physics code in the sandbox
        const code = `
          with (sandbox) {
            try {
              ${artifact.code.js || ''}
            } catch (error) {
              console.error('[Physics ${artifact.id}] Runtime error:', error);
            }
          }
        `;

        (new Function('sandbox', code))(sandboxEnvironment);

      } catch (error) {
        console.error(`[Physics ${artifact.id}] Initialization error:`, error);
        setMountError(error.message);
      }
    };

    // Initialize with a small delay to ensure DOM is ready
    const initTimer = setTimeout(initializePhysics, 100);

    return () => {
      cleanup();
      clearTimeout(initTimer);
    };
  }, [artifact.id, artifact.code]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      {mountError && (
        <div className="error">
          Failed to load physics simulation: {mountError}
        </div>
      )}
    </div>
  );
}

function PhysicsContainer({ artifact, onExpand }) {
  const room = new WebsimSocket();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isDeleting) return;
    
    if (!window.confirm('Are you sure you want to delete this physics artifact?')) {
      return;
    }
    
    setIsDeleting(true);
    try {
      await room.collection('physics_artifact').delete(artifact.id);
    } catch (error) {
      console.error('Failed to delete artifact:', error);
      alert('Failed to delete artifact. Please try again.');
      setIsDeleting(false);
    }
  };

  const isOwner = artifact.username === room.party.client.username;

  return (
    <div className="physics-container">
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
      <button className="expand-button" onClick={onExpand}>
        <svg className="expand-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>
        Expand
      </button>
      <div className="physics-content">
        <PhysicsContent artifact={artifact} />
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
          <div className="details-value">
            {new Intl.DateTimeFormat('default', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }).format(new Date(artifact.created_at))}
          </div>
        </div>
        <div className="details-section">
          <div className="details-label">Created By</div>
          <div className="details-value">{artifact.username}</div>
        </div>
      </div>
    </div>
  );
}