const {
  useState,
  useEffect,
  useSyncExternalStore,
  useRef,
  useCallback
} = React;

function initializePhysics(containerRef, artifact, mounted, setMountError) {
  try {
    // Bail early if container ref or mounted state is invalid
    if (!containerRef.current || !mounted) return;
    
    const sandbox = containerRef.current.querySelector('.physics-content');
    if (!sandbox) {
      throw new Error('Could not find physics content container');
    }

    // Create shadow DOM if needed
    let shadow = null;
    if (sandbox.shadowRoot) {
      sandbox.shadowRoot.innerHTML = '';
    } else {
      shadow = sandbox.attachShadow({ mode: 'open' });
    }

    // Create wrapper with scene container
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width: 100%; height: 100%; position: relative; display: flex; align-items: center; justify-content: center;';
    shadow.appendChild(wrapper);

    // Add scene container for 3D scenes if not present in HTML
    if (artifact.code.html.includes('scene-container') && !wrapper.querySelector('.scene-container')) {
      const sceneContainer = document.createElement('div');
      sceneContainer.className = 'scene-container';
      sceneContainer.style.cssText = 'width: 100%; height: 100%; position: relative;';
      wrapper.appendChild(sceneContainer);
    }

    // Add styles
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      :host {
        all: initial;
        display: flex;
        position: relative;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        contain: content;
      }
      ${artifact.code.css || ''}
      
      /* Ensure Three.js canvas fits properly */
      canvas {
        width: 100% !important;
        height: 100% !important;
        outline: none;
      }
      
      /* For 2D content */
      div {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    `;
    shadow.appendChild(styleElement);

    // Add HTML content after style element
    wrapper.innerHTML = artifact.code.html || '';

    // Setup sandbox environment
    const sandboxWindow = {
      innerWidth: wrapper.clientWidth,
      innerHeight: wrapper.clientHeight,
      addEventListener: (event, handler, options) => window.addEventListener(event, handler, options),
      removeEventListener: (event, handler, options) => window.removeEventListener(event, handler, options),
      requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
      devicePixelRatio: window.devicePixelRatio,
      dispatchEvent: (event) => window.dispatchEvent(event),
    };

    const sandboxEnvironment = {
      rootElement: wrapper,
      document: {
        getElementById: (id) => wrapper.querySelector('#' + id),
        querySelector: (sel) => wrapper.querySelector(sel),
        querySelectorAll: (sel) => wrapper.querySelectorAll(sel),
        createElement: (tag) => document.createElement(tag),
        createElementNS: (ns, tag) => document.createElementNS(ns, tag),
      },
      window: sandboxWindow,
      console: {
        log: (...args) => console.log(`[Physics ${artifact.id}]:`, ...args),
        error: (...args) => console.error(`[Physics ${artifact.id}]:`, ...args),
        warn: (...args) => console.warn(`[Physics ${artifact.id}]:`, ...args),
      },
      Math: Object.create(Math),
      THREE: window.THREE,
      CANNON: window.CANNON,
      initThreeScene: () => {
        const container = wrapper.querySelector('.scene-container') || wrapper;
        if (!container) {
          throw new Error('Could not find container for Three.js scene');
        }

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf8f9fa);
        
        const aspectRatio = container.clientWidth / container.clientHeight;
        const camera = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 1000);
        camera.position.set(4, 4, 4);
        camera.lookAt(0, 0, 0);
        
        const renderer = new THREE.WebGLRenderer({ 
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        container.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('data-engine', 'three.js');
        
        const lights = setupLights(scene);
        const controls = setupControls(camera, renderer);
        const grid = setupGrid(scene);
        
        function animate() {
          if (!mounted) return;
          requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        }
        
        animate();
        
        return {
          scene,
          camera,
          renderer,
          controls,
          dispose: () => {
            controls.dispose();
            renderer.dispose();
            lights.forEach(light => scene.remove(light));
            if (grid) scene.remove(grid);
            if (renderer.domElement && renderer.domElement.parentNode) {
              renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
          }
        };
      }
    };

    // Helper functions for Three.js scene setup
    function setupLights(scene) {
      const lights = [];
      const ambient = new THREE.AmbientLight(0xffffff, 0.5);
      scene.add(ambient);
      lights.push(ambient);

      const main = new THREE.DirectionalLight(0xffffff, 0.8);
      main.position.set(5, 5, 5);
      main.castShadow = true;
      main.shadow.mapSize.width = 1024;
      main.shadow.mapSize.height = 1024;
      scene.add(main);
      lights.push(main);

      const fill = new THREE.DirectionalLight(0xffffff, 0.3);
      fill.position.set(-5, 0, -5);
      scene.add(fill);
      lights.push(fill);

      return lights;
    }

    function setupControls(camera, renderer) {
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = true;
      controls.enableZoom = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1;
      return controls;
    }

    function setupGrid(scene) {
      const grid = new THREE.GridHelper(10, 10, 0xcccccc, 0xeeeeee);
      grid.material.opacity = 0.2;
      grid.material.transparent = true;
      scene.add(grid);
      return grid;
    }

    // Execute the artifact code
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

    // Return cleanup function
    return () => {
      mounted = false;
      if (shadow) {
        shadow.innerHTML = '';
      }
    };

  } catch (error) {
    console.error(`[Physics ${artifact.id}] Initialization error:`, error);
    setMountError(error.message);
    return () => {};
  }
}

function FullscreenModal({ isOpen, onClose, artifact }) {
  const containerRef = useRef();
  const [mountError, setMountError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    
    let mounted = true;
    const cleanup = initializePhysics(containerRef, artifact, mounted, setMountError);
    
    return () => {
      mounted = false;
      cleanup();
    };
  }, [isOpen, artifact]);

  if (!isOpen) return null;

  return (
    <div className={`fullscreen-modal ${isOpen ? 'active' : ''}`}>
      <div className="fullscreen-content" ref={containerRef}>
        <div className="fullscreen-header">
          <div className="fullscreen-title">{artifact.code.title}</div>
          <button className="fullscreen-close" onClick={onClose}>&times;</button>
        </div>
        <div className="fullscreen-body">
          <div className="physics-content">
            {mountError && (
              <div className="error">
                Failed to load physics simulation: {mountError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IterateModal({ isOpen, onClose, artifact }) {
  const [suggestions, setSuggestions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const room = new WebsimSocket();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const basePrompt = `Improve and iterate on this existing physics demonstration. Make it more detailed, more interactive, or add new features while maintaining its core concept.

Original demonstration:
Title: ${artifact.code.title}
Description: ${artifact.code.description}
Original Prompt: ${artifact.prompt}
${suggestions ? `User suggestions: ${suggestions}` : 'Make it better/more detailed to the best of your ability'}

The response must be valid JSON matching this interface:

interface PhysicsArtifact {
  html: string;
  css: string;
  js: string;
  title: string;
  description: string;
}`;

      const response = await fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          prompt: basePrompt,
          data: artifact.code,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      if (!artifactCode.html || !artifactCode.css || !artifactCode.js || !artifactCode.title || !artifactCode.description) {
        throw new Error('Invalid response format from AI');
      }

      await room.collection('physics_artifact').create({
        prompt: `[Iteration] ${artifact.prompt}${suggestions ? ` with suggestions: ${suggestions}` : ''}`,
        code: artifactCode,
        title: artifactCode.title,
        description: artifactCode.description,
        iteration_of: artifact.id,
      });

      onClose();
    } catch (error) {
      console.error('Error creating iteration:', error);
      alert('Failed to create iteration. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`iterate-modal ${isOpen ? 'active' : ''}`}>
      <div className="iterate-content">
        <div className="iterate-header">
          <div className="iterate-title">Iterate on "{artifact.code.title}"</div>
          <button className="iterate-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="iterate-form">
          <textarea
            className="iterate-input"
            value={suggestions}
            onChange={(e) => setSuggestions(e.target.value)}
            placeholder="Optional: Add your suggestions for improvements, or leave blank to let AI enhance it automatically..."
          />
          <div className="iterate-buttons">
            <button 
              type="button" 
              className="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Iteration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  return (
    <div className="pagination">
      <button 
        onClick={() => onPageChange(currentPage - 1)} 
        disabled={currentPage === 1}
        className="pagination-button"
      >
        ←
      </button>
      <span className="pagination-info">
        Page {currentPage} of {totalPages}
      </span>
      <button 
        onClick={() => onPageChange(currentPage + 1)} 
        disabled={currentPage === totalPages}
        className="pagination-button"
      >
        →
      </button>
    </div>
  );
}

function PhysicsContainer({ artifact }) {
  const containerRef = useRef();
  const room = new WebsimSocket();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [mountError, setMountError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isIterateModalOpen, setIsIterateModalOpen] = useState(false);
  const [iterationCount, setIterationCount] = useState(0);

  useEffect(() => {
    const countIterations = async () => {
      try {
        const allArtifacts = await room.collection('physics_artifact').getList();
        const iterationChain = new Set();
        let currentId = artifact.id;
        const visited = new Set();

        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          iterationChain.add(currentId);
          const current = allArtifacts.find(a => a.id === currentId);
          if (current && current.iteration_of) {
            currentId = current.iteration_of;
          } else {
            break;
          }
        }

        for (const chainId of iterationChain) {
          const children = allArtifacts.filter(a => a.iteration_of === chainId);
          children.forEach(child => iterationChain.add(child.id));
        }

        const chainArray = Array.from(iterationChain)
          .map(id => allArtifacts.find(a => a.id === id))
          .filter(a => a)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        const position = chainArray.findIndex(a => a.id === artifact.id);
        setIterationCount(position + 1);
      } catch (error) {
        console.error('Error counting iterations:', error);
        setIterationCount(1);
      }
    };

    countIterations();
  }, [artifact, room]);

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

  const handleFullscreen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFullscreen(true);
  };

  const handleIterate = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsIterateModalOpen(true);
  };

  useEffect(() => {
    let mounted = true;
    const cleanup = initializePhysics(containerRef, artifact, mounted, setMountError);
    
    return () => {
      mounted = false;
      cleanup();
    };
  }, [artifact]);

  const isOwner = artifact.username === room.party.client.username;

  return (
    <>
      <div className="physics-container" ref={containerRef}>
        {isOwner && (
          <button 
            className="delete-button" 
            onClick={handleDelete}
            disabled={isDeleting}
            title="Delete this artifact"
            type="button"
          >
            ×
          </button>
        )}
        <button 
          className="iterate-button" 
          onClick={handleIterate}
          title="Iterate and improve"
          type="button"
        >
          ↻
        </button>
        <button 
          className="fullscreen-button" 
          onClick={handleFullscreen}
          title="View fullscreen"
          type="button"
        >
          ⤢
        </button>
        <div className="iteration-badge" title={`Iteration #${iterationCount}`}>
          {iterationCount}
        </div>
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
      <FullscreenModal 
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        artifact={artifact}
      />
      <IterateModal
        isOpen={isIterateModalOpen}
        onClose={() => setIsIterateModalOpen(false)}
        artifact={artifact}
      />
    </>
  );
}

function PhysicsPlayground() {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const room = new WebsimSocket();
  
  const allArtifacts = useSyncExternalStore(
    room.collection('physics_artifact').subscribe,
    () => room.collection('physics_artifact').getList()
  );

  const totalPages = Math.ceil(allArtifacts.length / ITEMS_PER_PAGE);

  const paginatedArtifacts = allArtifacts
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    if (allArtifacts.length > 0 && currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [allArtifacts.length, currentPage, totalPages]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({
        top: document.querySelector('.gallery').offsetTop,
        behavior: 'smooth'
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Create an interactive physics demonstration or simulation based on the following prompt. 
          You have access to Three.js for 3D graphics and CANNON.js for physics simulations. 
          The Three.js library (with OrbitControls, GLTFLoader) and CANNON.js are already loaded.
          
          You can initialize a Three.js scene using the provided initThreeScene() helper:
          const { scene, camera, renderer, controls } = initThreeScene();
          
          For physics with CANNON.js, you can use it directly via the CANNON global:
          const world = new CANNON.World();
          world.gravity.set(0, -9.82, 0);
          
          Example with Three.js and CANNON.js:
          {
            "html": "<div class='scene-container'></div>",
            "css": ".scene-container { width: 100%; height: 100%; }",
            "js": "const { scene, camera, renderer, controls } = initThreeScene();\\n\\
                  camera.position.set(0, 5, 10);\\n\\
                  \\n\\
                  // Physics world\\n\\
                  const world = new CANNON.World();\\n\\
                  world.gravity.set(0, -9.82, 0);\\n\\
                  \\n\\
                  // Create a ground plane\\n\\
                  const groundBody = new CANNON.Body({\\n\\
                    mass: 0,\\n\\
                    shape: new CANNON.Plane()\\n\\
                  });\\n\\
                  groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI/2);\\n\\
                  world.addBody(groundBody);\\n\\
                  \\n\\
                  // Create a sphere\\n\\
                  const radius = 1;\\n\\
                  const sphereBody = new CANNON.Body({\\n\\
                    mass: 5,\\n\\
                    shape: new CANNON.Sphere(radius)\\n\\
                  });\\n\\
                  sphereBody.position.set(0, 10, 0);\\n\\
                  world.addBody(sphereBody);\\n\\
                  \\n\\
                  // Visual sphere\\n\\
                  const sphereGeometry = new THREE.SphereGeometry(radius);\\n\\
                  const sphereMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });\\n\\
                  const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);\\n\\
                  scene.add(sphereMesh);\\n\\
                  \\n\\
                  // Visual ground\\n\\
                  const groundGeometry = new THREE.PlaneGeometry(20, 20);\\n\\
                  const groundMaterial = new THREE.MeshPhongMaterial({ color: 0xcccccc });\\n\\
                  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);\\n\\
                  groundMesh.rotation.x = -Math.PI/2;\\n\\
                  scene.add(groundMesh);\\n\\
                  \\n\\
                  function animate() {\\n\\
                    requestAnimationFrame(animate);\\n\\
                    \\n\\
                    // Step the physics world\\n\\
                    world.step(1/60);\\n\\
                    \\n\\
                    // Copy coordinates from CANNON to Three.js\\n\\
                    sphereMesh.position.copy(sphereBody.position);\\n\\
                    sphereMesh.quaternion.copy(sphereBody.quaternion);\\n\\
                    \\n\\
                    renderer.render(scene, camera);\\n\\
                  }\\n\\
                  animate();",
            "title": "Bouncing Ball Physics",
            "description": "A demonstration of gravity and collision physics using CANNON.js with Three.js visualization"
          }

          The response must be valid JSON matching this interface:

          interface PhysicsArtifact {
            html: string;      // The HTML code for the demonstration
            css: string;       // The CSS styles for the demonstration
            js: string;        // The JavaScript code for the demonstration
            title: string;     // A short title describing the demonstration
            description: string; // A longer description explaining the physics concept
          }

          Create a physics demonstration for: ${prompt}`,
          data: prompt
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      if (!artifactCode.html || !artifactCode.css || !artifactCode.js || !artifactCode.title || !artifactCode.description) {
        throw new Error('Invalid response format from AI');
      }

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
        {paginatedArtifacts.map(artifact => (
          <PhysicsContainer key={artifact.id} artifact={artifact} />
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination 
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}

function init() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<PhysicsPlayground />);
}

init();