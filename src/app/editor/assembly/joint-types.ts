import type { JointType } from '@core/contracts';
import type { IconName } from '../../shared/icon';

/** How the editor names and explains each joint type. */
export const jointTypes: readonly { readonly type: JointType; readonly label: string; readonly description: string; readonly icon: IconName }[] = [
  { type: 'revolute', label: 'Revolute', description: 'Turns about the axis, like a hinge or a wheel on an axle.', icon: 'revolve' },
  { type: 'slider', label: 'Slider', description: 'Slides along the axis, like a drawer.', icon: 'joint' },
  { type: 'cylindrical', label: 'Cylindrical', description: 'Turns about and slides along the axis, like a piston rod.', icon: 'joint' },
  { type: 'pin-slot', label: 'Pin-slot', description: 'Turns about the axis and slides sideways, like a pin in a slot.', icon: 'joint' },
  { type: 'planar', label: 'Planar', description: 'Slides on the plane and turns about its normal.', icon: 'joint' },
  { type: 'ball', label: 'Ball', description: 'Turns freely about the point, like a ball joint.', icon: 'joint' },
  { type: 'rigid', label: 'Rigid', description: 'Holds the parts together; nothing moves.', icon: 'joint' },
];

export const jointLabel = (type: JointType): string => jointTypes.find((t) => t.type === type)?.label ?? type;
