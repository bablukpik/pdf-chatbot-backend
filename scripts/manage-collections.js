#!/usr/bin/env node

/**
 * Milvus Collection Management CLI
 *
 * Usage:
 *   node scripts/manage-collections.js list
 *   node scripts/manage-collections.js info <collection-name>
 *   node scripts/manage-collections.js count <collection-name>
 *   node scripts/manage-collections.js empty <collection-name>
 *   node scripts/manage-collections.js drop <collection-name>
 *   node scripts/manage-collections.js search <collection-name> "<query>"
 *
 * Partition Management:
 *   node scripts/manage-collections.js partitions <collection-name>
 *   node scripts/manage-collections.js partition-info <collection-name> <partition-name>
 *   node scripts/manage-collections.js partition-count <collection-name> <partition-name>
 *   node scripts/manage-collections.js create-partition <collection-name> <partition-name> [description]
 *   node scripts/manage-collections.js empty-partition <collection-name> <partition-name>
 *   node scripts/manage-collections.js drop-partition <collection-name> <partition-name>
 */

import 'dotenv/config';
import MilvusManager from '../utils/milvus-manager.js';

const command = process.argv[2];
const collectionName = process.argv[3];
const partitionName = process.argv[4];
const query = process.argv[4];
const description = process.argv[5];

const manager = new MilvusManager();

async function main() {
  try {
    switch (command) {
      case 'list':
        await listCollections();
        break;

      case 'info':
        if (!collectionName) {
          console.error('❌ Collection name is required for info command');
          console.log(
            'Usage: node scripts/manage-collections.js info <collection-name>',
          );
          process.exit(1);
        }
        await getCollectionInfo(collectionName);
        break;

      case 'count':
        if (!collectionName) {
          console.error('❌ Collection name is required for count command');
          console.log(
            'Usage: node scripts/manage-collections.js count <collection-name>',
          );
          process.exit(1);
        }
        await getVectorCount(collectionName);
        break;

      case 'empty':
        if (!collectionName) {
          console.error('❌ Collection name is required for empty command');
          console.log(
            'Usage: node scripts/manage-collections.js empty <collection-name>',
          );
          process.exit(1);
        }
        await emptyCollection(collectionName);
        break;

      case 'drop':
        if (!collectionName) {
          console.error('❌ Collection name is required for drop command');
          console.log(
            'Usage: node scripts/manage-collections.js drop <collection-name>',
          );
          process.exit(1);
        }
        await dropCollection(collectionName);
        break;

      case 'search':
        if (!collectionName || !query) {
          console.error(
            '❌ Collection name and query are required for search command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js search <collection-name> "<query>"',
          );
          process.exit(1);
        }
        await searchVectors(collectionName, query);
        break;

      // Partition Management Commands
      case 'partitions':
        if (!collectionName) {
          console.error(
            '❌ Collection name is required for partitions command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js partitions <collection-name>',
          );
          process.exit(1);
        }
        await listPartitions(collectionName);
        break;

      case 'partition-info':
        if (!collectionName || !partitionName) {
          console.error(
            '❌ Collection name and partition name are required for partition-info command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js partition-info <collection-name> <partition-name>',
          );
          process.exit(1);
        }
        await getPartitionInfo(collectionName, partitionName);
        break;

      case 'partition-count':
        if (!collectionName || !partitionName) {
          console.error(
            '❌ Collection name and partition name are required for partition-count command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js partition-count <collection-name> <partition-name>',
          );
          process.exit(1);
        }
        await getPartitionCount(collectionName, partitionName);
        break;

      case 'create-partition':
        if (!collectionName || !partitionName) {
          console.error(
            '❌ Collection name and partition name are required for create-partition command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js create-partition <collection-name> <partition-name> [description]',
          );
          process.exit(1);
        }
        await createPartition(collectionName, partitionName, description);
        break;

      case 'empty-partition':
        if (!collectionName || !partitionName) {
          console.error(
            '❌ Collection name and partition name are required for empty-partition command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js empty-partition <collection-name> <partition-name>',
          );
          process.exit(1);
        }
        await emptyPartition(collectionName, partitionName);
        break;

      case 'drop-partition':
        if (!collectionName || !partitionName) {
          console.error(
            '❌ Collection name and partition name are required for drop-partition command',
          );
          console.log(
            'Usage: node scripts/manage-collections.js drop-partition <collection-name> <partition-name>',
          );
          process.exit(1);
        }
        await dropPartition(collectionName, partitionName);
        break;

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        console.error('❌ Unknown command:', command);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await manager.close();
  }
}

async function listCollections() {
  console.log('📋 Listing all collections...');
  const result = await manager.listCollections();

  if (result.success) {
    console.log(`✅ Found ${result.count} collections:`);
    result.collections.forEach((name) => {
      console.log(`  - ${name}`);
    });
  } else {
    console.error('❌ Failed to list collections:', result.error);
  }
}

async function getCollectionInfo(collectionName) {
  console.log(`📊 Getting info for collection: ${collectionName}`);
  const result = await manager.getCollectionInfo(collectionName);

  if (result.success) {
    console.log('✅ Collection Information:');
    console.log(`  Name: ${result.info.name}`);
    console.log(`  Description: ${result.info.description || 'N/A'}`);
    console.log(`  Shards: ${result.info.shards}`);
    console.log(`  Consistency Level: ${result.info.consistencyLevel}`);
    console.log(`  Row Count: ${result.statistics.rowCount}`);
    console.log(`  Data Size: ${result.statistics.dataSize} bytes`);
    console.log('  Fields:');
    result.info.fields.forEach((field) => {
      console.log(`    - ${field.name} (${field.data_type})`);
    });
  } else {
    console.error('❌ Failed to get collection info:', result.error);
  }
}

async function getVectorCount(collectionName) {
  console.log(`🔢 Getting vector count for collection: ${collectionName}`);
  const result = await manager.getVectorCount(collectionName);

  if (result.success) {
    console.log(
      `✅ Collection "${collectionName}" contains ${result.rowCount} vectors`,
    );
    console.log(`   Data size: ${result.dataSize} bytes`);
  } else {
    console.error('❌ Failed to get vector count:', result.error);
  }
}

async function emptyCollection(collectionName) {
  console.log(`🗑️  Emptying collection: ${collectionName}`);
  console.log('⚠️  This will delete ALL vectors in the collection!');

  // In a real CLI, you might want to add a confirmation prompt
  const result = await manager.emptyCollection(collectionName);

  if (result.success) {
    console.log(`✅ Collection "${collectionName}" emptied successfully`);
  } else {
    console.error('❌ Failed to empty collection:', result.error);
  }
}

async function dropCollection(collectionName) {
  console.log(`💥 Dropping collection: ${collectionName}`);
  console.log('⚠️  This will PERMANENTLY DELETE the entire collection!');

  // In a real CLI, you might want to add a confirmation prompt
  const result = await manager.dropCollection(collectionName, true);

  if (result.success) {
    console.log(`✅ Collection "${collectionName}" dropped successfully`);
  } else {
    console.error('❌ Failed to drop collection:', result.error);
  }
}

async function searchVectors(collectionName, query) {
  console.log(`🔍 Searching in collection: ${collectionName}`);
  console.log(`Query: "${query}"`);

  const result = await manager.searchVectors(collectionName, query);

  if (result.success) {
    console.log(`✅ Found ${result.count} results:`);
    result.results.forEach((doc, index) => {
      console.log(
        `\n${index + 1}. Content: ${doc.content.substring(0, 100)}...`,
      );
      console.log(`   Metadata:`, doc.metadata);
    });
  } else {
    console.error('❌ Failed to search vectors:', result.error);
  }
}

async function listPartitions(collectionName) {
  console.log(`📋 Listing partitions in collection: ${collectionName}`);
  const result = await manager.listPartitions(collectionName);

  if (result.success) {
    console.log(`✅ Found ${result.count} partitions:`);
    result.partitions.forEach((name) => {
      console.log(`  - ${name}`);
    });
  } else {
    console.error('❌ Failed to list partitions:', result.error);
  }
}

async function getPartitionInfo(collectionName, partitionName) {
  console.log(
    `📊 Getting info for partition: ${partitionName} in collection: ${collectionName}`,
  );
  const result = await manager.getPartitionStats(collectionName, partitionName);

  if (result.success) {
    console.log('✅ Partition Information:');
    console.log(`  Collection: ${result.collectionName}`);
    console.log(`  Partition: ${result.partitionName}`);
    console.log(`  Row Count: ${result.rowCount}`);
    console.log(`  Data Size: ${result.dataSize} bytes`);
  } else {
    console.error('❌ Failed to get partition info:', result.error);
  }
}

async function getPartitionCount(collectionName, partitionName) {
  console.log(
    `🔢 Getting vector count for partition: ${partitionName} in collection: ${collectionName}`,
  );
  const result = await manager.getPartitionStats(collectionName, partitionName);

  if (result.success) {
    console.log(
      `✅ Partition "${partitionName}" contains ${result.rowCount} vectors`,
    );
    console.log(`   Data size: ${result.dataSize} bytes`);
  } else {
    console.error('❌ Failed to get partition count:', result.error);
  }
}

async function createPartition(collectionName, partitionName, description) {
  console.log(
    `➕ Creating partition: ${partitionName} in collection: ${collectionName}`,
  );
  if (description) {
    console.log(`   Description: ${description}`);
  }

  const result = await manager.createPartition(
    collectionName,
    partitionName,
    description,
  );

  if (result.success) {
    console.log(`✅ Partition "${partitionName}" created successfully`);
    if (result.description) {
      console.log(`   Description: ${result.description}`);
    }
  } else {
    console.error('❌ Failed to create partition:', result.error);
  }
}

async function emptyPartition(collectionName, partitionName) {
  console.log(
    `🗑️  Emptying partition: ${partitionName} in collection: ${collectionName}`,
  );
  console.log('⚠️  This will delete ALL vectors in the partition!');

  const result = await manager.emptyPartition(collectionName, partitionName);

  if (result.success) {
    console.log(`✅ Partition "${partitionName}" emptied successfully`);
  } else {
    console.error('❌ Failed to empty partition:', result.error);
  }
}

async function dropPartition(collectionName, partitionName) {
  console.log(
    `💥 Dropping partition: ${partitionName} in collection: ${collectionName}`,
  );
  console.log(
    '⚠️  This will PERMANENTLY DELETE the partition and all its vectors!',
  );

  const result = await manager.dropPartition(
    collectionName,
    partitionName,
    true,
  );

  if (result.success) {
    console.log(`✅ Partition "${partitionName}" dropped successfully`);
  } else {
    console.error('❌ Failed to drop partition:', result.error);
  }
}

function showHelp() {
  console.log(`
📚 Milvus Collection Management CLI

Collection Commands:
  list                    List all collections
  info <name>            Get detailed information about a collection
  count <name>           Get vector count in a collection
  empty <name>           Empty a collection (delete all vectors)
  drop <name>            Drop a collection (permanent deletion)
  search <name> "<query>" Search for vectors in a collection

Partition Commands:
  partitions <name>      List all partitions in a collection
  partition-info <name> <partition> Get detailed information about a partition
  partition-count <name> <partition> Get vector count in a partition
  create-partition <name> <partition> [description] Create a new partition
  empty-partition <name> <partition> Empty a partition (delete all vectors)
  drop-partition <name> <partition> Drop a partition (permanent deletion)

General:
  help                   Show this help message

Examples:
  # Collection operations
  node scripts/manage-collections.js list
  node scripts/manage-collections.js info pdf_documents
  node scripts/manage-collections.js count pdf_documents
  node scripts/manage-collections.js search pdf_documents "machine learning"
  node scripts/manage-collections.js empty pdf_documents
  node scripts/manage-collections.js drop pdf_documents

  # Partition operations
  node scripts/manage-collections.js partitions pdf_documents
  node scripts/manage-collections.js partition-info pdf_documents _default
  node scripts/manage-collections.js partition-count pdf_documents _default
  node scripts/manage-collections.js create-partition pdf_documents new_partition "My new partition"
  node scripts/manage-collections.js empty-partition pdf_documents _default
  node scripts/manage-collections.js drop-partition pdf_documents old_partition

⚠️  Warning: empty and drop commands are destructive and irreversible!
`);
}

// Run the CLI
main();
