import * as THREE from 'three';
import {OrbitControls} from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/examples/jsm/controls/OrbitControls.js';

import { picker, texture, tileSize, tileTextureHeight, nbMaterial } from './materials.js'


const cellSize = 5;

const material = new THREE.MeshLambertMaterial({
  map: texture,
  side: THREE.DoubleSide,
  alphaTest: 0.1,
  transparent: true,
});

//no need to export VoxelWorld, it's used by main and that function is already exported to HelloWorld
class VoxelWorld {
  constructor(options) {
    this.cellSize = options.cellSize;
    this.tileSize = options.tileSize;
    this.nbMaterial = options.nbMaterial;
    this.tileTextureHeight = options.tileTextureHeight;
    const {cellSize} = this;
    this.cellSliceSize = cellSize * cellSize;
    this.cells = {};

    this.cellIdToMesh = {};
    this.scene = null;
  }
  computeVoxelOffset(x, y, z) {
    const {cellSize, cellSliceSize} = this;
    const voxelX = THREE.MathUtils.euclideanModulo(x, cellSize) | 0;
    const voxelY = THREE.MathUtils.euclideanModulo(y, cellSize) | 0;
    const voxelZ = THREE.MathUtils.euclideanModulo(z, cellSize) | 0;
    return voxelY * cellSliceSize +
           voxelZ * cellSize +
           voxelX;
  }
  computeCellId(x, y, z) {
    const {cellSize} = this;
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const cellZ = Math.floor(z / cellSize);
    return `${cellX},${cellY},${cellZ}`;
  }
  addCellForVoxel(x, y, z) {
    const cellId = this.computeCellId(x, y, z);
    let cell = this.cells[cellId];
    if (!cell) {
      const {cellSize} = this;
      cell = new Uint8Array(cellSize * cellSize * cellSize);
      this.cells[cellId] = cell;
    }
    return cell;
  }
  getCellForVoxel(x, y, z) {
    return this.cells[this.computeCellId(x, y, z)];
  }
  setVoxel(x, y, z, v, addCell = true) {
    if (Math.abs(x)>cellSize*2 || Math.abs(z)>cellSize*2) {
        return;
    }
    let cell = this.getCellForVoxel(x, y, z);
    if (!cell) {
      if (!addCell) {
        return;
      }
      cell = this.addCellForVoxel(x, y, z);
    }
    const voxelOffset = this.computeVoxelOffset(x, y, z);
    cell[voxelOffset] = v;
    if(v==0){
      picker.tempStore[picker.material]-=1;
    }
    else{
   picker.tempStore[picker.material] +=1 ;
    }
    console.log(picker.tempStore);
  }
  getVoxel(x, y, z) {
    const cell = this.getCellForVoxel(x, y, z);
    if (!cell) {
      return 0;
    }
    const voxelOffset = this.computeVoxelOffset(x, y, z);
    return cell[voxelOffset];
  }
  generateGeometryDataForCell(cellX, cellY, cellZ) {
    const {cellSize, tileSize, nbMaterial, tileTextureHeight} = this;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const startX = cellX * cellSize;
    const startY = cellY * cellSize;
    const startZ = cellZ * cellSize;

    for (let y = 0; y < cellSize; ++y) {
      const voxelY = startY + y;
      for (let z = 0; z < cellSize; ++z) {
        const voxelZ = startZ + z;
        for (let x = 0; x < cellSize; ++x) {
          const voxelX = startX + x;
          const voxel = this.getVoxel(voxelX, voxelY, voxelZ);
          if (voxel) {
            // voxel 0 is sky (empty) so for UVs we start at 0
            const uvVoxel = voxel - 1;
            // There is a voxel here but do we need faces for it?
            for (const {dir, corners, uvRow} of VoxelWorld.faces) {
              const neighbor = this.getVoxel(
                  voxelX + dir[0],
                  voxelY + dir[1],
                  voxelZ + dir[2]);
              if (!neighbor) {
                // this voxel has no neighbor in this direction so we need a face.
                const ndx = positions.length / 3;
                for (const {pos, uv} of corners) {
                  positions.push(pos[0] + x, pos[1] + y, pos[2] + z);
                  normals.push(...dir);
                  uvs.push(
                        (uvVoxel +   uv[0]) * tileSize / nbMaterial,
                    1 - (uvRow + 1 - uv[1]) * tileSize / tileTextureHeight);
                }
                indices.push(
                  ndx, ndx + 1, ndx + 2,
                  ndx + 2, ndx + 1, ndx + 3,
                );
              }
            }
          }
        }
      }
    }

    return {
      positions,
      normals,
      uvs,
      indices,
    };
  }
  
  updateCellGeometry(x, y, z) {
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const cellZ = Math.floor(z / cellSize);
    const cellId = this.computeCellId(x, y, z);
    let mesh = this.cellIdToMesh[cellId];
    const geometry = mesh ? mesh.geometry : new THREE.BufferGeometry();

    const {positions, normals, uvs, indices} = this.generateGeometryDataForCell(cellX, cellY, cellZ);
    const positionNumComponents = 3;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), positionNumComponents));
    const normalNumComponents = 3;
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), normalNumComponents));
    const uvNumComponents = 2;
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), uvNumComponents));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      mesh.name = cellId;
      this.cellIdToMesh[cellId] = mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      mesh.position.set(cellX * cellSize, cellY * cellSize, cellZ * cellSize);
    }
  }

  updateVoxelGeometry(x, y, z) {
    const neighborOffsets = [
      [ 0,  0,  0], // self
      [-1,  0,  0], // left
      [ 1,  0,  0], // right
      [ 0, -1,  0], // down
      [ 0,  1,  0], // up
      [ 0,  0, -1], // back
      [ 0,  0,  1], // front
    ];
  
    const updatedCellIds = {};
    for (const offset of neighborOffsets) {
      const ox = x + offset[0];
      const oy = y + offset[1];
      const oz = z + offset[2];
      const cellId = this.computeCellId(ox, oy, oz);
      if (!updatedCellIds[cellId]) {
        updatedCellIds[cellId] = true;
        this.updateCellGeometry(ox, oy, oz);
      }
    }
  }

    // from
    // http://www.cse.chalmers.se/edu/year/2010/course/TDA361/grid.pdf
    intersectRay(start, end) {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let dz = end.z - start.z;
    const lenSq = dx * dx + dy * dy + dz * dz;
    const len = Math.sqrt(lenSq);

    dx /= len;
    dy /= len;
    dz /= len;

    let t = 0.0;
    let ix = Math.floor(start.x);
    let iy = Math.floor(start.y);
    let iz = Math.floor(start.z);

    const stepX = (dx > 0) ? 1 : -1;
    const stepY = (dy > 0) ? 1 : -1;
    const stepZ = (dz > 0) ? 1 : -1;

    const txDelta = Math.abs(1 / dx);
    const tyDelta = Math.abs(1 / dy);
    const tzDelta = Math.abs(1 / dz);

    const xDist = (stepX > 0) ? (ix + 1 - start.x) : (start.x - ix);
    const yDist = (stepY > 0) ? (iy + 1 - start.y) : (start.y - iy);
    const zDist = (stepZ > 0) ? (iz + 1 - start.z) : (start.z - iz);

    // location of nearest voxel boundary, in units of t
    let txMax = (txDelta < Infinity) ? txDelta * xDist : Infinity;
    let tyMax = (tyDelta < Infinity) ? tyDelta * yDist : Infinity;
    let tzMax = (tzDelta < Infinity) ? tzDelta * zDist : Infinity;

    let steppedIndex = -1;

    // main loop along raycast vector
    while (t <= len) {
      const voxel = this.getVoxel(ix, iy, iz);
      if (voxel || iy < 0) {
        return {
          position: [
            start.x + t * dx,
            start.y + t * dy,
            start.z + t * dz,
          ],
          normal: [
            steppedIndex === 0 ? -stepX : 0,
            steppedIndex === 1 ? -stepY : 0,
            steppedIndex === 2 ? -stepZ : 0,
          ],
          voxel,
        };
      }

      // advance t to next nearest voxel boundary
      if (txMax < tyMax) {
        if (txMax < tzMax) {
          ix += stepX;
          t = txMax;
          txMax += txDelta;
          steppedIndex = 0;
        } else {
          iz += stepZ;
          t = tzMax;
          tzMax += tzDelta;
          steppedIndex = 2;
        }
      } else {
        if (tyMax < tzMax) {
          iy += stepY;
          t = tyMax;
          tyMax += tyDelta;
          steppedIndex = 1;
        } else {
          iz += stepZ;
          t = tzMax;
          tzMax += tzDelta;
          steppedIndex = 2;
        }
      }
    }
    return null;
  }
}

VoxelWorld.faces = [
  { // left
    uvRow: 0,
    dir: [ -1,  0,  0, ],
    corners: [
      { pos: [ 0, 1, 0 ], uv: [ 0, 1 ], },
      { pos: [ 0, 0, 0 ], uv: [ 0, 0 ], },
      { pos: [ 0, 1, 1 ], uv: [ 1, 1 ], },
      { pos: [ 0, 0, 1 ], uv: [ 1, 0 ], },
    ],
  },
  { // right
    uvRow: 0,
    dir: [  1,  0,  0, ],
    corners: [
      { pos: [ 1, 1, 1 ], uv: [ 0, 1 ], },
      { pos: [ 1, 0, 1 ], uv: [ 0, 0 ], },
      { pos: [ 1, 1, 0 ], uv: [ 1, 1 ], },
      { pos: [ 1, 0, 0 ], uv: [ 1, 0 ], },
    ],
  },
  { // bottom
    uvRow: 1,
    dir: [  0, -1,  0, ],
    corners: [
      { pos: [ 1, 0, 1 ], uv: [ 1, 0 ], },
      { pos: [ 0, 0, 1 ], uv: [ 0, 0 ], },
      { pos: [ 1, 0, 0 ], uv: [ 1, 1 ], },
      { pos: [ 0, 0, 0 ], uv: [ 0, 1 ], },
    ],
  },
  { // top
    uvRow: 2,
    dir: [  0,  1,  0, ],
    corners: [
      { pos: [ 0, 1, 1 ], uv: [ 1, 1 ], },
      { pos: [ 1, 1, 1 ], uv: [ 0, 1 ], },
      { pos: [ 0, 1, 0 ], uv: [ 1, 0 ], },
      { pos: [ 1, 1, 0 ], uv: [ 0, 0 ], },
    ],
  },
  { // back
    uvRow: 0,
    dir: [  0,  0, -1, ],
    corners: [
      { pos: [ 1, 0, 0 ], uv: [ 0, 0 ], },
      { pos: [ 0, 0, 0 ], uv: [ 1, 0 ], },
      { pos: [ 1, 1, 0 ], uv: [ 0, 1 ], },
      { pos: [ 0, 1, 0 ], uv: [ 1, 1 ], },
    ],
  },
  { // front
    uvRow: 0,
    dir: [  0,  0,  1, ],
    corners: [
      { pos: [ 0, 0, 1 ], uv: [ 0, 0 ], },
      { pos: [ 1, 0, 1 ], uv: [ 1, 0 ], },
      { pos: [ 0, 1, 1 ], uv: [ 0, 1 ], },
      { pos: [ 1, 1, 1 ], uv: [ 1, 1 ], },
    ],
  },
];

function generateGrid() {
  var gridXZ = new THREE.GridHelper(cellSize*2, cellSize*2, 0xffff00, 0xffff00);
  gridXZ.position.set(Math.floor(cellSize/2), 0,Math.floor(cellSize/2));
  return gridXZ;
}
function generatePlane(){
  var geometry = new THREE.PlaneBufferGeometry(cellSize*2, cellSize*2);
  var material = new THREE.MeshPhongMaterial( {color: 0x009624, side: THREE.DoubleSide });
  var planeXZ = new THREE.Mesh(geometry, material);
  planeXZ.receiveShadow = true ;
  planeXZ.position.set(Math.floor(cellSize/2), 0,Math.floor(cellSize/2));
  planeXZ.rotateX( - Math.PI / 2);
  return planeXZ;
}

export var voxWorld;

export  function main(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas});
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  
  

  const fov = 75;
  const aspect = 2;  // the canvas default
  const near = 0.1;
  const far = 1000;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(-cellSize * .3, cellSize * .8, -cellSize * .3);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(cellSize / 2, cellSize / 3, cellSize / 2);
  controls.update();

  const scene = new THREE.Scene();

  function generateSkybox() {
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.load([
      'src/assets/skybox/Daylight-Box_Back.jpg',
      'src/assets/skybox/Daylight-Box_Bottom.jpg', //here Vite uses the absolute path, can't use ./
      'src/assets/skybox/Daylight-Box_Front.jpg',
      'src/assets/skybox/Daylight-Box_Left.jpg',
      'src/assets/skybox/Daylight-Box_Right.jpg',
      'src/assets/skybox/Daylight-Box_Top.jpg',
    ]);
    scene.background = texture;
}
generateSkybox()

  function addLight(x, y, z) {
    const color = 0xFFFFFF;
    const intensity = 0.5;
    const lightSpot = new THREE.DirectionalLight(color, intensity, 18);
    lightSpot.position.set(x, y, z);
    lightSpot.castShadow = true;
    lightSpot.shadow.bias = +0.01;
    lightSpot.shadow.camera.near = 0.1;
    lightSpot.shadow.camera.far = 100;

    const ambientLight = new THREE.AmbientLight(color, 0.4);
    scene.add(ambientLight);
    scene.add(lightSpot);
  }
  addLight(-1,  2,  4);
  addLight( 1, -1, -2);

  scene.add(generateGrid());
  scene.add(generatePlane());

  voxWorld = new VoxelWorld({
    cellSize,
    tileSize,
    nbMaterial,
    tileTextureHeight,
  });
  voxWorld.scene = scene;
  const world = voxWorld;

  /*
  for (let y = 0; y < cellSize; ++y) {
    for (let z = 0; z < cellSize; ++z) {
      for (let x = 0; x < cellSize; ++x) {
        const height = (Math.sin(x / cellSize * Math.PI * 2) + Math.sin(z / cellSize * Math.PI * 3)) * (cellSize / 6) + (cellSize / 2);
        if (y < height) {
          world.setVoxel(x, y, z, randInt(1, nbMaterial*tileTextureHeight+1));
        }
      }
    }
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
  }
*/

  world.updateVoxelGeometry(1, 1, 1);  // 0,0,0 will generate

  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }

  let renderRequested = false;

  function render() {
    renderRequested = undefined;

    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();

  function getCanvasRelativePosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width  / rect.width,
      y: (event.clientY - rect.top ) * canvas.height / rect.height,
    };
  }

  function placeVoxel(event) {
    const pos = getCanvasRelativePosition(event);
    const x = (pos.x / canvas.width ) *  2 - 1;
    const y = (pos.y / canvas.height) * -2 + 1;  // note we flip Y

    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    start.setFromMatrixPosition(camera.matrixWorld);
    end.set(x, y, 1).unproject(camera);

    const intersection = world.intersectRay(start, end);
    if (intersection) {
      const voxelId = event.shiftKey ? 0 : picker.material;
      // the intersection point is on the face. That means
      // the math imprecision could put us on either side of the face.
      // so go half a normal into the voxel if removing (pickerMaterial = 0)
      // our out of the voxel if adding (pickerMaterial  > 0)
      const pos = intersection.position.map((v, ndx) => {
        return v + intersection.normal[ndx] * (voxelId > 0 ? 0.5 : -0.5);
      });
      world.setVoxel(...pos, voxelId);
      world.updateVoxelGeometry(...pos);
    }
  }

  const mouse = {
    x: 0,
    y: 0,
  };

  function recordStartPosition(event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.moveX = 0;
    mouse.moveY = 0;
  }
  function recordMovement(event) {
    mouse.moveX += Math.abs(mouse.x - event.clientX);
    mouse.moveY += Math.abs(mouse.y - event.clientY);
  }
  function placeVoxelIfNoMovement(event) {
    if (mouse.moveX < 5 && mouse.moveY < 5) {
      placeVoxel(event);
    }
    window.removeEventListener('pointermove', recordMovement);
    window.removeEventListener('pointerup', placeVoxelIfNoMovement);
  }
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    recordStartPosition(event);
    window.addEventListener('pointermove', recordMovement);
    window.addEventListener('pointerup', placeVoxelIfNoMovement);
  }, {passive: false});
  canvas.addEventListener('touchstart', (event) => {
    // prevent scrolling
    event.preventDefault();
  }, {passive: false});
}
