import React, { useEffect, useRef } from 'react';
import type { DriveResource } from '../../types/appResources';
import { createDrivePdfPreview } from './DrivePdfPreview';

export function DrivePdfView({ resource }: { resource: DriveResource }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const preview = createDrivePdfPreview(resource);
    host.current?.append(preview);
    return () => preview.remove();
  }, [resource.serverId, resource.externalId]);
  return <div ref={host} />;
}
