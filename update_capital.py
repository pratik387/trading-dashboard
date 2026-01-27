"""
One-time script to add capital field to a specific run's performance.json in OCI.
Usage: python update_capital.py
"""

import json
import oci

# Configuration
BUCKET_NAME = 'live-trading-logs'
RUN_ID = 'live_20260127_074113'
CONFIG_TYPE = 'live'
CAPITAL = 50000  # The capital used for this run

def main():
    # Initialize OCI client
    config = oci.config.from_file()
    os_client = oci.object_storage.ObjectStorageClient(config)
    namespace = os_client.get_namespace().data

    object_name = f"{CONFIG_TYPE}/{RUN_ID}/performance.json"

    print(f"Reading: {object_name}")

    # Download current performance.json
    try:
        obj = os_client.get_object(
            namespace_name=namespace,
            bucket_name=BUCKET_NAME,
            object_name=object_name
        )
        perf_data = json.loads(obj.data.content.decode('utf-8'))
        print(f"Current data: {json.dumps(perf_data, indent=2)}")
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Add capital field
    if 'capital' in perf_data:
        print(f"Capital already set to: {perf_data['capital']}")
        return

    perf_data['capital'] = CAPITAL
    print(f"\nAdding capital: {CAPITAL}")

    # Upload updated file
    updated_content = json.dumps(perf_data, indent=2).encode('utf-8')

    os_client.put_object(
        namespace_name=namespace,
        bucket_name=BUCKET_NAME,
        object_name=object_name,
        put_object_body=updated_content,
        content_type='application/json'
    )

    print(f"\nUpdated successfully!")
    print(f"New data: {json.dumps(perf_data, indent=2)}")

if __name__ == "__main__":
    main()
