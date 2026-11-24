import { AnimationObjectGroup } from '../../../../src/animation/AnimationObjectGroup.js';
import { AnimationMixer } from '../../../../src/animation/AnimationMixer.js';
import { AnimationClip } from '../../../../src/animation/AnimationClip.js';
import { VectorKeyframeTrack } from '../../../../src/animation/tracks/VectorKeyframeTrack.js';

import { Object3D } from '../../../../src/core/Object3D.js';
import { PropertyBinding } from '../../../../src/animation/PropertyBinding.js';

export default QUnit.module( 'Animation', () => {

	QUnit.module( 'AnimationObjectGroup', () => {

		const ObjectA = new Object3D(),
			ObjectB = new Object3D(),
			ObjectC = new Object3D(),

			PathA = 'object.position',
			PathB = 'object.rotation',
			PathC = 'object.scale',

			ParsedPathA = PropertyBinding.parseTrackName( PathA ),
			ParsedPathB = PropertyBinding.parseTrackName( PathB ),
			ParsedPathC = PropertyBinding.parseTrackName( PathC );

		// INSTANCING
		QUnit.test( 'Instancing', ( assert ) => {

			const groupA = new AnimationObjectGroup();
			assert.ok(
				groupA instanceof AnimationObjectGroup,
				'AnimationObjectGroup can be instantiated'
			);

		} );

		// PUBLIC
		QUnit.test( 'isAnimationObjectGroup', ( assert ) => {

			const object = new AnimationObjectGroup();
			assert.ok(
				object.isAnimationObjectGroup,
				'AnimationObjectGroup.isAnimationObjectGroup should be true'
			);

		} );

		// OTHERS
		QUnit.test( 'smoke test', ( assert ) => {

			var expect = function expect( testIndex, group, bindings, path, cached, roots ) {

				var rootNodes = [], pathsOk = true, nodesOk = true;

				for ( let i = group.nCachedObjects_, n = bindings.length; i !== n; ++ i ) {

					if ( bindings[ i ].path !== path ) pathsOk = false;
					rootNodes.push( bindings[ i ].rootNode );

				}

				for ( let i = 0, n = roots.length; i !== n; ++ i ) {

					if ( rootNodes.indexOf( roots[ i ] ) === - 1 ) nodesOk = false;

				}

				assert.ok( pathsOk, QUnit.testIndex + ' paths' );
				assert.ok( nodesOk, QUnit.testIndex + ' nodes' );
				assert.ok( group.nCachedObjects_ === cached, QUnit.testIndex + ' cache size' );
				assert.ok( bindings.length - group.nCachedObjects_ === roots.length, QUnit.testIndex + ' object count' );

			};

			// initial state

			const groupA = new AnimationObjectGroup();
			assert.ok( groupA instanceof AnimationObjectGroup, 'constructor (w/o args)' );

			const bindingsAA = groupA.subscribe_( PathA, ParsedPathA );
			expect( 0, groupA, bindingsAA, PathA, 0, [] );

			const groupB = new AnimationObjectGroup( ObjectA, ObjectB );
			assert.ok( groupB instanceof AnimationObjectGroup, 'constructor (with args)' );

			const bindingsBB = groupB.subscribe_( PathB, ParsedPathB );
			expect( 1, groupB, bindingsBB, PathB, 0, [ ObjectA, ObjectB ] );

			// add

			groupA.add( ObjectA, ObjectB );
			expect( 2, groupA, bindingsAA, PathA, 0, [ ObjectA, ObjectB ] );

			groupB.add( ObjectC );
			expect( 3, groupB, bindingsBB, PathB, 0, [ ObjectA, ObjectB, ObjectC ] );

			// remove

			groupA.remove( ObjectA, ObjectC );
			expect( 4, groupA, bindingsAA, PathA, 1, [ ObjectB ] );

			groupB.remove( ObjectA, ObjectB, ObjectC );
			expect( 5, groupB, bindingsBB, PathB, 3, [] );

			// subscribe after re-add

			groupA.add( ObjectC );
			expect( 6, groupA, bindingsAA, PathA, 1, [ ObjectB, ObjectC ] );
			const bindingsAC = groupA.subscribe_( PathC, ParsedPathC );
			expect( 7, groupA, bindingsAC, PathC, 1, [ ObjectB, ObjectC ] );

			// re-add after subscribe

			const bindingsBC = groupB.subscribe_( PathC, ParsedPathC );
			groupB.add( ObjectA, ObjectB );
			expect( 8, groupB, bindingsBB, PathB, 1, [ ObjectA, ObjectB ] );

			// unsubscribe

			const copyOfBindingsBC = bindingsBC.slice();
			groupB.unsubscribe_( PathC );
			groupB.add( ObjectC );
			assert.deepEqual( bindingsBC, copyOfBindingsBC, 'no more update after unsubscribe' );

			// uncache active

			groupB.uncache( ObjectA );
			expect( 9, groupB, bindingsBB, PathB, 0, [ ObjectB, ObjectC ] );

			// uncache cached

			groupA.uncache( ObjectA );
			expect( 10, groupA, bindingsAC, PathC, 0, [ ObjectB, ObjectC ] );

		} );

		QUnit.test( 'shared mixer handles membership changes, overlapping actions and stop restore', ( assert ) => {

			const vector = ( x, y, z ) => [ x, y, z ];
			const positionAt = ( i ) => vector( 100 + i, 200 + i, 300 + i );
			const scaleAt = ( i ) => vector( 20 + i, 40 + i, 60 + i );

			const makeValues = ( at, count ) => {

				const values = [];

				for ( let i = 0; i < count; i ++ ) {

					values.push( ...at( i ) );

				}

				return values;

			};

			const makeActor = ( name, position, scale ) => {

				const object = new Object3D();
				object.name = name;
				object.position.fromArray( position );
				object.scale.fromArray( scale );
				return object;

			};

			const initialPositionA = vector( 0, 10, 20 );
			const initialPositionB = vector( 30, 40, 50 );
			const initialPositionC = vector( 60, 70, 80 );
			const initialScaleA = vector( 1, 2, 3 );
			const initialScaleB = vector( 4, 5, 6 );
			const initialScaleC = vector( 7, 8, 9 );

			const actorA = makeActor( 'A', initialPositionA, initialScaleA );
			const actorB = makeActor( 'B', initialPositionB, initialScaleB );
			const actorC = makeActor( 'C', initialPositionC, initialScaleC );

			const group = new AnimationObjectGroup( actorA, actorB, actorC );
			const mixer = new AnimationMixer( group );

			const blockingClip = new AnimationClip( 'blocking', 10, [
				new VectorKeyframeTrack(
					'.position',
					[ 0, 1, 2, 3, 4, 5, 6 ],
					makeValues( positionAt, 7 )
				)
			] );

			const scalingClip = new AnimationClip( 'scaling', 10, [
				new VectorKeyframeTrack(
					'.scale',
					[ 0, 1, 2, 3, 4 ],
					makeValues( scaleAt, 5 )
				)
			] );

			const blockingAction = mixer.clipAction( blockingClip ).play();

			// The shared blocking clip has its own opening pose.
			mixer.update( 0 );
			assert.deepEqual( actorA.position.toArray(), positionAt( 0 ), 'A starts at the blocking opening pose' );
			assert.deepEqual( actorB.position.toArray(), positionAt( 0 ), 'B starts at the blocking opening pose' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 0 ), 'C starts at the blocking opening pose' );

			mixer.update( 1 );
			assert.deepEqual( actorA.position.toArray(), positionAt( 1 ), 'A receives the first blocking frame' );
			assert.deepEqual( actorB.position.toArray(), positionAt( 1 ), 'B receives the first blocking frame' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 1 ), 'C receives the first blocking frame' );

			// A leaves the group but remains cached; C is completely uncached.
			group.remove( actorA );
			mixer.update( 1 );

			assert.deepEqual( actorB.position.toArray(), positionAt( 2 ), 'active B receives blocking frame 2' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 2 ), 'active C receives blocking frame 2' );
			assert.deepEqual( actorA.position.toArray(), positionAt( 1 ), 'cached A keeps its last blocking pose' );

			group.uncache( actorC );
			mixer.update( 1 );

			assert.deepEqual( actorB.position.toArray(), positionAt( 3 ), 'B continues after C is uncached' );
			assert.deepEqual( actorA.position.toArray(), positionAt( 1 ), 'cached A is not updated' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 2 ), 'uncached C freezes its last received pose' );

			// The scaling action is created while A is cached and C is unknown.
			// B is the first active object and therefore supplies the shared scale baseline.
			const scalingAction = mixer.clipAction( scalingClip ).play();
			mixer.update( 0 );

			assert.deepEqual( actorB.scale.toArray(), scaleAt( 0 ), 'B receives the scaling opening pose' );
			assert.deepEqual( actorA.scale.toArray(), initialScaleA, 'cached A keeps its initial scale when scaling starts' );
			assert.deepEqual( actorC.scale.toArray(), initialScaleC, 'uncached C keeps its initial scale when scaling starts' );

			// The two actions now overlap.
			mixer.update( 1 );

			assert.deepEqual( actorB.position.toArray(), positionAt( 4 ), 'B receives blocking frame 4 during overlap' );
			assert.deepEqual( actorB.scale.toArray(), scaleAt( 1 ), 'B receives scale frame 1 during overlap' );
			assert.deepEqual( actorA.position.toArray(), positionAt( 1 ), 'A remains frozen while cached' );
			assert.deepEqual( actorA.scale.toArray(), initialScaleA, 'A receives no scale while cached' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 2 ), 'C remains frozen while uncached' );
			assert.deepEqual( actorC.scale.toArray(), initialScaleC, 'C receives no scale while uncached' );

			// The completely removed character rejoins first. Its new bindings must target C.
			group.add( actorC );
			mixer.update( 1 );

			assert.deepEqual( actorC.position.toArray(), positionAt( 5 ), 're-added C receives the current blocking pose' );
			assert.deepEqual( actorC.scale.toArray(), scaleAt( 2 ), 'action started during absence writes scale to C' );
			assert.deepEqual( actorB.position.toArray(), positionAt( 5 ), 'B also receives blocking frame 5' );
			assert.deepEqual( actorB.scale.toArray(), scaleAt( 2 ), 'B also receives scale frame 2' );
			assert.deepEqual( actorA.position.toArray(), positionAt( 1 ), 'A is still absent and remains frozen' );
			assert.deepEqual( actorA.scale.toArray(), initialScaleA, 'A still receives no scale' );

			// The temporarily cached character returns after the scaling action was created.
			group.add( actorA );
			mixer.update( 1 );

			assert.deepEqual( actorA.position.toArray(), positionAt( 6 ), 're-added A receives the current blocking pose' );
			assert.deepEqual( actorA.scale.toArray(), scaleAt( 3 ), 'scaling created while A was absent writes to A after re-add' );
			assert.deepEqual( actorB.position.toArray(), positionAt( 6 ), 'B stays synchronized after A returns' );
			assert.deepEqual( actorB.scale.toArray(), scaleAt( 3 ), 'B stays scaled after A returns' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 6 ), 'C stays synchronized after A returns' );
			assert.deepEqual( actorC.scale.toArray(), scaleAt( 3 ), 'C stays scaled after A returns' );

			// C is absent when blocking control is taken back.
			group.remove( actorC );
			blockingAction.stop();

			assert.deepEqual( actorA.position.toArray(), initialPositionA, 'active A restores the blocking baseline captured from A' );
			assert.deepEqual( actorB.position.toArray(), initialPositionA, 'active B restores the shared blocking group baseline' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 6 ), 'absent C keeps its last received position' );
			assert.deepEqual( actorA.scale.toArray(), scaleAt( 3 ), 'stopping blocking does not stop scaling on A' );
			assert.deepEqual( actorB.scale.toArray(), scaleAt( 3 ), 'stopping blocking does not stop scaling on B' );
			assert.deepEqual( actorC.scale.toArray(), scaleAt( 3 ), 'C retains its last received scale when blocking stops' );

			// Scaling remains independently active after blocking has been stopped.
			mixer.update( 1 );

			assert.deepEqual( actorA.position.toArray(), initialPositionA, 'A keeps the restored blocking baseline' );
			assert.deepEqual( actorB.position.toArray(), initialPositionA, 'B keeps the restored blocking group baseline' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 6 ), 'absent C still keeps its frozen position' );
			assert.deepEqual( actorA.scale.toArray(), scaleAt( 4 ), 'scaling continues on A after blocking stops' );
			assert.deepEqual( actorB.scale.toArray(), scaleAt( 4 ), 'scaling continues on B after blocking stops' );
			assert.deepEqual( actorC.scale.toArray(), scaleAt( 3 ), 'absent C does not receive the next scale frame' );

			// Taking back scale control restores the baseline captured when scaling took over.
			scalingAction.stop();

			assert.deepEqual( actorA.scale.toArray(), initialScaleB, 'active A restores the shared scale baseline captured from B' );
			assert.deepEqual( actorB.scale.toArray(), initialScaleB, 'active B restores its scale as the group scale baseline' );
			assert.deepEqual( actorC.scale.toArray(), scaleAt( 3 ), 'absent C keeps its last actually received scale' );
			assert.deepEqual( actorA.position.toArray(), initialPositionA, 'scale stop leaves restored blocking position on A' );
			assert.deepEqual( actorB.position.toArray(), initialPositionA, 'scale stop leaves restored blocking baseline on B' );
			assert.deepEqual( actorC.position.toArray(), positionAt( 6 ), 'scale stop leaves frozen position on C' );

		} );

	} );

} );
