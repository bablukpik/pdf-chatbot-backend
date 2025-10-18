import 'dotenv/config';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Milvus } from '@langchain/community/vectorstores/milvus';

/**
 * Advanced Milvus Collection Manager
 * Provides comprehensive collection and vector management capabilities
 */
class MilvusManager {
  constructor() {
    this.client = new MilvusClient({
      address: process.env.MILVUS_URL || 'localhost:19530',
    });
    this.collectionName = process.env.MILVUS_COLLECTION_NAME;
  }

  /**
   * List all collections in the Milvus instance
   */
  async listCollections() {
    try {
      const collections = await this.client.listCollections();
      return {
        success: true,
        collections: collections.collection_names || [],
        count: collections.collection_names?.length || 0,
      };
    } catch (error) {
      console.error('Error listing collections:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get detailed information about a specific collection
   */
  async getCollectionInfo(collectionName) {
    try {
      const info = await this.client.describeCollection({
        collection_name: collectionName,
      });

      const stats = await this.client.getCollectionStatistics({
        collection_name: collectionName,
      });

      return {
        success: true,
        collectionName,
        info: {
          name: info.collection_name,
          description: info.description,
          fields: info.fields,
          shards: info.shards_num,
          consistencyLevel: info.consistency_level,
        },
        statistics: {
          rowCount: stats.row_count,
          dataSize: stats.data_size,
        },
      };
    } catch (error) {
      console.error('Error getting collection info:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if a collection exists
   */
  async collectionExists(collectionName) {
    try {
      const collections = await this.client.listCollections();
      return collections.collection_names?.includes(collectionName) || false;
    } catch (error) {
      console.error('Error checking collection existence:', error);
      return false;
    }
  }

  /**
   * Delete specific vectors by metadata filter
   */
  async deleteVectorsByFilter(collectionName, filter) {
    try {
      const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
      });

      const vectorStore = await Milvus.fromExistingCollection(embeddings, {
        address: process.env.MILVUS_URL || 'localhost:19530',
        collectionName: collectionName,
      });

      // Delete vectors using the filter
      const result = await vectorStore.delete({ filter });

      return {
        success: true,
        message: 'Vectors deleted successfully',
        collectionName,
        filter,
        result,
      };
    } catch (error) {
      console.error('Error deleting vectors:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete all vectors from a collection (empty the collection)
   */
  async emptyCollection(collectionName) {
    try {
      // First, check if collection exists
      const exists = await this.collectionExists(collectionName);
      if (!exists) {
        return {
          success: false,
          error: 'Collection does not exist',
        };
      }

      // Load the collection
      await this.client.loadCollection({
        collection_name: collectionName,
      });

      // Delete all vectors by using a filter that matches all documents
      // This is a simplified approach - in production, you might want to
      // iterate through all vectors or use a more specific approach
      const result = await this.client.delete({
        collection_name: collectionName,
        filter: 'id >= 0', // This should match all vectors
      });

      return {
        success: true,
        message: 'Collection emptied successfully',
        collectionName,
        result,
      };
    } catch (error) {
      console.error('Error emptying collection:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Drop (delete) an entire collection
   */
  async dropCollection(collectionName, confirm = false) {
    try {
      if (!confirm) {
        return {
          success: false,
          error: 'Collection deletion requires confirmation',
          message: 'Set confirm=true to proceed with deletion',
        };
      }

      // Check if collection exists
      const exists = await this.collectionExists(collectionName);
      if (!exists) {
        return {
          success: false,
          error: 'Collection does not exist',
        };
      }

      // Drop the collection
      await this.client.dropCollection({
        collection_name: collectionName,
      });

      return {
        success: true,
        message: 'Collection dropped successfully',
        collectionName,
      };
    } catch (error) {
      console.error('Error dropping collection:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get vector count in a collection
   */
  async getVectorCount(collectionName) {
    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: collectionName,
      });

      return {
        success: true,
        collectionName,
        rowCount: stats.row_count,
        dataSize: stats.data_size,
      };
    } catch (error) {
      console.error('Error getting vector count:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Search for vectors by metadata
   */
  async searchVectors(collectionName, query, limit = 10) {
    try {
      const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
      });

      const vectorStore = await Milvus.fromExistingCollection(embeddings, {
        address: process.env.MILVUS_URL || 'localhost:19530',
        collectionName: collectionName,
      });

      const results = await vectorStore.similaritySearch(query, limit);

      return {
        success: true,
        query,
        results: results.map((doc) => ({
          content: doc.pageContent,
          metadata: doc.metadata,
        })),
        count: results.length,
      };
    } catch (error) {
      console.error('Error searching vectors:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all partitions in a collection
   */
  async listPartitions(collectionName) {
    try {
      const partitions = await this.client.showPartitions({
        collection_name: collectionName,
      });

      return {
        success: true,
        collectionName,
        partitions: partitions.partition_names || [],
        count: partitions.partition_names?.length || 0,
      };
    } catch (error) {
      console.error('Error listing partitions:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get partition statistics
   */
  async getPartitionStats(collectionName, partitionName) {
    try {
      const stats = await this.client.getPartitionStatistics({
        collection_name: collectionName,
        partition_name: partitionName,
      });

      return {
        success: true,
        collectionName,
        partitionName,
        rowCount: stats.row_count,
        dataSize: stats.data_size,
      };
    } catch (error) {
      console.error('Error getting partition stats:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete all vectors from a specific partition
   */
  async emptyPartition(collectionName, partitionName) {
    try {
      // Check if collection exists
      const exists = await this.collectionExists(collectionName);
      if (!exists) {
        return {
          success: false,
          error: 'Collection does not exist',
        };
      }

      // Load the collection
      await this.client.loadCollection({
        collection_name: collectionName,
      });

      // Delete all vectors in the partition
      const result = await this.client.delete({
        collection_name: collectionName,
        partition_name: partitionName,
        filter: 'id >= 0', // This should match all vectors in the partition
      });

      return {
        success: true,
        message: 'Partition emptied successfully',
        collectionName,
        partitionName,
        result,
      };
    } catch (error) {
      console.error('Error emptying partition:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Drop (delete) a partition
   */
  async dropPartition(collectionName, partitionName, confirm = false) {
    try {
      if (!confirm) {
        return {
          success: false,
          error: 'Partition deletion requires confirmation',
          message: 'Set confirm=true to proceed with deletion',
        };
      }

      // Check if collection exists
      const exists = await this.collectionExists(collectionName);
      if (!exists) {
        return {
          success: false,
          error: 'Collection does not exist',
        };
      }

      // Drop the partition
      await this.client.dropPartition({
        collection_name: collectionName,
        partition_name: partitionName,
      });

      return {
        success: true,
        message: 'Partition dropped successfully',
        collectionName,
        partitionName,
      };
    } catch (error) {
      console.error('Error dropping partition:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create a new partition
   */
  async createPartition(collectionName, partitionName, description = '') {
    try {
      // Check if collection exists
      const exists = await this.collectionExists(collectionName);
      if (!exists) {
        return {
          success: false,
          error: 'Collection does not exist',
        };
      }

      // Create the partition
      await this.client.createPartition({
        collection_name: collectionName,
        partition_name: partitionName,
        description,
      });

      return {
        success: true,
        message: 'Partition created successfully',
        collectionName,
        partitionName,
        description,
      };
    } catch (error) {
      console.error('Error creating partition:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Close the Milvus client connection
   */
  async close() {
    try {
      await this.client.closeConnection();
      return { success: true, message: 'Connection closed' };
    } catch (error) {
      console.error('Error closing connection:', error);
      return { success: false, error: error.message };
    }
  }
}

export default MilvusManager;
