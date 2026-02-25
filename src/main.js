import './style.scss'
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { gsap } from 'gsap';  // Animation intro

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, -100);

// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
// s'assurer que la caméra démarre à z=100 (intro)
// camera.position.set(0, 0, -100);

// Animation intro (Texte)
const instructions = document.getElementById('instructions');


// Lights
const pointLight = new THREE.PointLight(0xffffff);
pointLight.position.set(5, 5, 5);

const ambientLight = new THREE.AmbientLight(0xffffff);

// Helpers
// const lightHelper = new THREE.PointLightHelper(pointLight);
// const gridHelper = new THREE.GridHelper(200, 50);
// scene.add(lightHelper, gridHelper);
const gridhelper = new THREE.GridHelper(200, 50);

// Ambient global existant
scene.add(pointLight, ambientLight, gridhelper);

// Ambient light supplémentaire centrée (n'affecte pas la position mais permet d'ajuster l'ambiance)
const ambientCenter = new THREE.AmbientLight(0x99bbff, 0.6);
ambientCenter.name = 'ambientCenter';
scene.add(ambientCenter);

// PointerLockControls pour contrôle libre (regarder + marcher)
const controls = new PointerLockControls(camera, renderer.domElement);

// UI flags for blocking movement/rotation when info panel is open
let uiOpen = false;
let lockedCameraQuat = null;

// Click pour verrouiller le pointeur (look around) — ignore si UI ouvert
document.addEventListener('click', (e) => {
  if (uiOpen) return;
  controls.lock();
});

// Movement state
const moveState = { forward: false, backward: false, left: false, right: false, up: false, down: false };
const SPEED = 20; // unités par seconde, ajuster si besoin

// Intro control
let introStarted = false;
let introFinished = false;
let _pendingScaleAnimation = false;
function startIntro() {
  if (introStarted) return;
  introStarted = true;
  introFinished = false;
  gsap.to(camera.position, {
    z: 0,
    duration: 8,
    ease: 'power2.inOut',
    delay: 0.5,
    onUpdate: () => {
      camera.lookAt(0, 0, -100);
      if (controls && typeof controls.update === 'function') controls.update();
    },
    onComplete: () => {
      introFinished = true;
      console.log('Intro finie !');
      // Si le texte est déjà créé, animer son scale, sinon marquer en attente
      try {
        if (typeof textMesh !== 'undefined' && textMesh) {
          gsap.to(textMesh.scale, { x: 3, y: 3, z: 3, duration: 1.2, ease: 'elastic.out(1, 0.5)' });
        } else {
          _pendingScaleAnimation = true;
        }
        // Faire disparaître les instructions (fade out puis display none)
      try {
        if (instructions) {
          gsap.to(instructions, { opacity: 0, duration: 0.8, onComplete: () => { instructions.style.display = 'none'; } });
        }
      } catch (e) {
        if (instructions) instructions.style.display = 'none';
      }
      } catch (e) {
        _pendingScaleAnimation = true;
      }
    }
  });
}

function onKeyDown(event) {
  // Pendant l'intro, n'autoriser que Space (et Escape pour unlock)
  if (!introFinished) {
    if (event.code === 'Space') { moveState.up = true; startIntro(); }
    if (event.code === 'Escape') { controls.unlock(); }
    return;
  }

  // Si panneau info ouvert, bloquer mouvements et rotation; mais permettre Escape pour fermer
  if (uiOpen) {
    if (event.code === 'Escape') { hideModelInfo(); }
    return;
  }

  switch (event.code) {
    case 'KeyW': moveState.forward = true; break;
    case 'KeyS': moveState.backward = true; break;
    case 'KeyA': moveState.left = true; break;
    case 'KeyD': moveState.right = true; break;
    case 'Space': moveState.up = true; break;
    case 'Escape': controls.unlock(); break;
    case 'ShiftLeft': moveState.down = true; break;
  }
}

function onKeyUp(event) {
  // Pendant l'intro, n'autoriser que Space release
  if (!introFinished) {
    if (event.code === 'Space') moveState.up = false;
    return;
  }

  if (uiOpen) return; // ignore key ups when UI open

  switch (event.code) {
    case 'KeyW': moveState.forward = false; break;
    case 'KeyS': moveState.backward = false; break;
    case 'KeyA': moveState.left = false; break;
    case 'KeyD': moveState.right = false; break;
    case 'Space': moveState.up = false; break;
    case 'ShiftLeft': moveState.down = false; break;
  }
}

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

let prevTime = performance.now();

// Marqueur placé au centre du champ de vue (quelques unités devant la caméra)
const MARKER_DISTANCE = 10; // distance devant la caméra
const markerGeometry = new THREE.SphereGeometry(0.15, 8, 8);
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
const cameraMarker = new THREE.Mesh(markerGeometry, markerMaterial);
scene.add(cameraMarker);
const _cameraDir = new THREE.Vector3();

// Raycaster pour interaction (click) et interaction frontale (KeyE)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let loadedObjModel = null; // référence au modèle OBJ chargé

function isDescendant(object, parent) {
  let o = object;
  while (o) {
    if (o === parent) return true;
    o = o.parent;
  }
  return false;
}

function findRootModel(target, rootModel) {
  let o = target;
  while (o) {
    if (o === rootModel) return o;   // on a trouvé le Group du modèle
    o = o.parent;
  }
  return null;
}

function handleModelClick(target) {
  const model = loadedObjModel ? findRootModel(target, loadedObjModel) : null;
  const infoText = model?.userData?.info || 'Modèle sélectionné';
  showModelInfo(infoText);
}


function hideModelInfo() {
  const panel = document.getElementById('modelInfo');
  if (!panel) return;
  gsap.killTweensOf(panel);
  panel.classList.remove('active');
  gsap.to(panel, { opacity: 0, duration: 0.18, onComplete: () => { panel.remove(); } });
  uiOpen = false;
  lockedCameraQuat = null;
}

// showModelInfo: crée/affiche un panneau #modelInfo et gère fermeture
function showModelInfo(text) {
  let panel = document.getElementById('modelInfo');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'modelInfo';
    Object.assign(panel.style, {
      position: 'fixed',
      left: '50%',
      top: '12%',
      transform:
      'translateX(-50%)',
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      padding: '12px 16px',
      borderRadius: '6px',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      zIndex: 9999,
      pointerEvents: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      minWidth: '180px',
      opacity: '0'
    });

    const textNode = document.createElement('div');
    textNode.id = 'modelInfoText';
    Object.assign(textNode.style, { flex: '1' });
    panel.appendChild(textNode);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: 'none',
      color: '#fff',
      fontSize: '20px',
      cursor: 'pointer',
      lineHeight: '1'
    });
    closeBtn.addEventListener('click', hideModelInfo);
    panel.appendChild(closeBtn);

    document.body.appendChild(panel);

    // Fermer au clic extérieur
    document.addEventListener('click', (ev) => {
      const p = document.getElementById('modelInfo');
      if (!p) return;
      if (ev.target === p || p.contains(ev.target)) return;
      if (ev.target === renderer.domElement) return;
      hideModelInfo();
    });
  }
  const textNode = document.getElementById('modelInfoText');
  if (textNode) textNode.textContent = text;
  gsap.killTweensOf(panel);
  // mark UI open, lock camera rotation state and stop movement
  uiOpen = true;
  try { lockedCameraQuat = camera.quaternion.clone(); } catch (e) { lockedCameraQuat = null; }
  moveState.forward = moveState.backward = moveState.left = moveState.right = moveState.up = moveState.down = false;
  try { controls.unlock(); } catch (e) {}
  panel.classList.add('active');
  gsap.to(panel, { opacity: 1, duration: 0.18 });
}

// Click : fonctionne quand le pointeur n'est pas verrouillé
renderer.domElement.addEventListener('click', (event) => {
  if (controls.isLocked) return; // évite de capturer le click de lock
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length > 0) {
    const hit = intersects.find(i => loadedObjModel ? isDescendant(i.object, loadedObjModel) : true);
    if (hit) handleModelClick(hit.object);
  }
});

// Key 'E' : interaction frontale quand PointerLock est actif
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE') return;
  if (!controls.isLocked) return;
  camera.getWorldDirection(_cameraDir);
  raycaster.set(camera.position, _cameraDir);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length > 0) {
    const hit = intersects.find(i => loadedObjModel ? isDescendant(i.object, loadedObjModel) : true);
    if (hit && hit.distance <= 50) { // distance seuil
      handleModelClick(hit.object);
    }
  }
});



function animate() {
  requestAnimationFrame(animate);
  // torus retiré — pas d'animation pour l'anneau

  // Déplacement basé sur PointerLockControls
  const time = performance.now();
  const delta = (time - prevTime) / 1000; // en secondes
  prevTime = time;

  // Calcul direction
  const moveZ = (moveState.forward ? 1 : 0) - (moveState.backward ? 1 : 0);
  const moveX = (moveState.right ? 1 : 0) - (moveState.left ? 1 : 0);
  const moveY = (moveState.up ? 1 : 0) - (moveState.down ? 1 : 0);

  if (controls.isLocked) {
    if (moveZ !== 0) controls.moveForward(moveZ * SPEED * delta);
    if (moveX !== 0) controls.moveRight(moveX * SPEED * delta);
    if (moveY !== 0) camera.position.y += moveY * SPEED * delta;
  }

  // If UI is open, keep camera rotation frozen
  if (uiOpen && lockedCameraQuat) {
    camera.quaternion.copy(lockedCameraQuat);
  }

  // (overlay titre désactivé)
  // Met à jour la position du marqueur devant la caméra
  camera.getWorldDirection(_cameraDir);
  cameraMarker.position.copy(camera.position).add(_cameraDir.multiplyScalar(MARKER_DISTANCE));
  renderer.render(scene, camera);
}

animate();

// Texte 
const loader = new FontLoader();
const fontUrl = new URL('./fonts/Soloist Laser_Regular.json', import.meta.url).href;
const font = await loader.loadAsync(fontUrl);
const textGeometry = new TextGeometry("Arthur Fanton\nExplore My Room", {
  font: font,
  size: 4,
  height: 2,
  depth: 1,
  curveSegments: 12,
  bevelEnabled: true,
  bevelThickness: 0.1,
  bevelSize: 0.1,
  bevelOffset: 0,
  bevelSegments: 5
});
// Centrer le pivot de la géométrie au milieu du texte
textGeometry.computeBoundingBox();
if (textGeometry.boundingBox) {
  const center = new THREE.Vector3();
  textGeometry.boundingBox.getCenter(center);
  textGeometry.translate(-center.x, -center.y, -center.z);
}
const textMesh = new THREE.Mesh(textGeometry, [
  new THREE.MeshPhongMaterial({ color: "#A67C52" }), // front
  new THREE.MeshPhongMaterial({ color: "#F5F5DC" })  // side
]);
textMesh.position.set(0, 0, -130);
scene.add(textMesh);
scene.add(textMesh);

// Charger un modèle OBJ (asynchrone)
try {
  const objUrl = new URL('./obj/test.obj', import.meta.url).href;
  // Try to load associated MTL first (same basename 'test')
  const mtlUrl = new URL('./obj/test.mtl', import.meta.url).href;
  try {
    const mtlLoader = new MTLLoader();
    const materials = await new Promise((resolve, reject) => {
      mtlLoader.load(mtlUrl, resolve, undefined, reject);
    });
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    var objModel = await new Promise((resolve, reject) => {
      objLoader.load(objUrl, resolve, undefined, reject);
    });
  } catch (mtlErr) {
    console.warn('MTL non trouvé ou erreur, chargement OBJ sans matériaux', mtlErr);
    const objLoader = new OBJLoader();
    var objModel = await new Promise((resolve, reject) => {
      objLoader.load(objUrl, resolve, undefined, reject);
    });
  }
  loadedObjModel = objModel;
  // Texte initial affiché dans le panneau d'info pour tout le modèle
  objModel.userData = objModel.userData || {};
  objModel.userData.info =
    "Ce projet, réalisé dans le cadre du Jour de la Terre, consistait à concevoir en équipe une série de 2 à 3 affiches promotionnelles (une par membre) pour présenter un concept de jeu vidéo ou d’application Web. L’objectif était de créer des visuels qui piquent la curiosité du public cible tout en mettant de l’avant des enjeux environnementaux.";
  // Activer ombres si nécessaire
  objModel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      // Si le matériau est basique, on peut le remplacer ou ajuster
      if (!child.material) child.material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    }
  });
  // Ajuster échelle et position par défaut — modifiez selon votre modèle
  objModel.scale.set(3, 3, 3);
  objModel.position.set(0, 0, 0);
  scene.add(objModel);
} catch (e) {
  console.warn('Erreur lors du chargement de l\'OBJ :', e);
}

// Stars
// function addStar() {
//   const geometry = new THREE.BoxGeometry(1, 1, 1);
//   const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
//   const star = new THREE.Mesh(geometry, material);

//   const [x, y, z] = Array(3).fill().map(() => THREE.MathUtils.randFloatSpread(100));

//   star.position.set(x, y, z);
//   scene.add(star);
// }
// Array(200).fill().forEach(addStar);

// Background
// Couleur de fond et brouillard léger
renderer.setClearColor(0x5A7D9A);
scene.fog = new THREE.FogExp2(0x5A7D9A, 0.0015);

// Ajuster la taille du canvas et l'aspect quand la fenêtre change
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize, false);

// Faire apparaître le paragraphe de contact au clic
try {
  const contactEl = document.querySelector('.contact');
  if (contactEl) {
    // fonction qui crée et anime une bulle partant du centre de l'élément contact
    function createBubbleFromContact(el) {
      try {
        // Si une bulle persistante existe déjà, ne rien faire
        const existing = document.querySelector('.contact-bubble--persist');
        if (existing) return existing;

        const rect = el.getBoundingClientRect();
        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;
        const bubble = document.createElement('div');
        bubble.className = 'contact-bubble';
        Object.assign(bubble.style, {
          left: `${startX}px`,
          top: `${startY}px`,
          width: '12px',
          height: '12px',
          opacity: '0.98'
        });
        document.body.appendChild(bubble);

        // Animer vers 200x200 et légèrement vers le haut, puis garder la bulle en place
        gsap.to(bubble, {
          duration: 0.6,
          width: '400px',
          height: '400px',
          top: `${startY - 160}px`,
          left: `${startX + 90}px`,
          ease: 'power2.out',
          onComplete: () => {
            bubble.classList.add('contact-bubble--persist');
            Object.assign(bubble.style, { opacity: '1', width: '400px', height: '400px' });
          }
        });
        return bubble;
      } catch (e) {
        console.warn('createBubbleFromContact erreur', e);
      }
    }

    contactEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      contactEl.classList.toggle('show');
      // Si une bulle persistante existe, l'animer et la supprimer
      const existing = document.querySelector('.contact-bubble--persist');
      if (existing) {
        try {
          const rect = contactEl.getBoundingClientRect();
          const endX = rect.left + rect.width / 2;
          const endY = rect.top + rect.height / 2;
          gsap.to(existing, {
            duration: 3,
            width: '12px',
            height: '12px',
            top: `${endY}px`,
            left: `${endX}px`,
            opacity: '0',
            ease: 'power2.in',
            onComplete: () => {
              // avant de supprimer, jouer une petite rafale d'étincelles
              try { createSparks(existing, 6); } catch (e) { console.warn(e); }
              setTimeout(() => { existing.remove(); }, 350);
            }
          });
        } catch (e) {
          existing.remove();
        }
        return;
      }
      createBubbleFromContact(contactEl);
    });
  }
} catch (e) {
  console.warn('Erreur initialisation contact click', e);
}

// Crée plusieurs petites étincelles autour d'un élément (élément en position fixed)
function createSparks(anchorEl, count = 8) {
  try {
    const rect = anchorEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < count; i++) {
      const spark = document.createElement('div');
      spark.className = 'contact-spark';
      const angle = Math.random() * Math.PI * 2;
      const distance = 30 + Math.random() * 70; // spread radius
      const tx = cx + Math.cos(angle) * distance;
      const ty = cy + Math.sin(angle) * distance - (10 + Math.random() * 30);
      Object.assign(spark.style, {
        left: `${cx}px`,
        top: `${cy}px`,
        opacity: '1',
        transform: 'translate(-50%, -50%) scale(0.6)'
      });
      document.body.appendChild(spark);

      gsap.to(spark, {
        duration: 0.9 + Math.random() * 0.6,
        left: `${tx}px`,
        top: `${ty}px`,
        opacity: 0,
        scale: 0.2,
        ease: 'power2.out',
        onComplete: () => { spark.remove(); }
      });
    }
  } catch (e) { console.warn('createSparks error', e); }
}

// Fin du fichier — autres ajouts possibles : audio, interaction, textures...
// test